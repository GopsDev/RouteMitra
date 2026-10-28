# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""Keep each Address's latitude/longitude in step with its text."""

import frappe
from frappe.utils import flt, now_datetime

from routemitra.routemitra_core.doctype.routemitra_settings.routemitra_settings import get_settings
from routemitra.utils.geo import GeocodingError, geocode, locate_postcode

ADDRESS_TEXT_FIELDS = ("address_line1", "address_line2", "city", "state", "pincode", "country")
GEOCODE_TASK = "routemitra.routemitra_core.tasks.geocode_address"
# A result farther than this from the PIN code's centre is a same-named place elsewhere.
PIN_RADIUS_KM = 30
PIN_CACHE_SECONDS = 30 * 24 * 3600  # PIN code centres don't move
# Set by a person (typed, or captured at the shop); automatic lookups never overwrite them.
PINNED_STATUSES = ("Manual", "GPS")


def handle_address_update(doc):
	"""
	Queue a lookup when the address text changed; mark hand-entered
	coordinates as Manual so they are never overwritten.
	"""
	if doc.flags.rm_geocoding:
		return

	coordinates_edited = doc.has_value_changed("latitude") or doc.has_value_changed("longitude")
	if coordinates_edited and flt(doc.latitude) and flt(doc.longitude):
		# "GPS" is set by the form's Set Location from GPS button; anything else typed is Manual.
		status = "GPS" if doc.geocode_status == "GPS" else "Manual"
		doc.db_set(
			{"geocode_status": status, "geocoded_on": now_datetime(), "location_set_by": frappe.session.user},
			update_modified=False,
		)
		return

	if doc.geocode_status in PINNED_STATUSES or not get_settings().auto_geocode:
		return
	text_changed = any(doc.has_value_changed(field) for field in ADDRESS_TEXT_FIELDS)
	if not (text_changed or not doc.geocode_status):
		return
	if text_changed and doc.geocode_status:
		# Clear the old result so "Locate All Addresses" retries it if the job can't run.
		doc.db_set({"geocode_status": "", "latitude": 0, "longitude": 0}, update_modified=False)
	try:
		frappe.enqueue(GEOCODE_TASK, queue="short", address=doc.name, enqueue_after_commit=True)
	except Exception:
		# Saving an address must never fail because the job queue is down.
		frappe.log_error(title=f"RouteMitra: could not queue location lookup for {doc.name}")


def geocode_address(address_name, force=False):
	"""
	Look up and store one Address's coordinates: the full address first
	("Located"), then locality fallbacks, then the PIN code's centre
	("Approximate"). Every result must lie within PIN_RADIUS_KM of the PIN
	code, which stops a same-named village in another district winning.

	Parameters:
	        address_name (str, required): Address name.
	        force (bool, optional): Also re-locate Manual addresses.

	Returns:
	        str: The resulting geocode_status.
	"""
	doc = frappe.get_doc("Address", address_name)
	if doc.geocode_status in PINNED_STATUSES and not force:
		return doc.geocode_status

	settings = get_settings()
	lookup = (settings.provider, settings.google_api_key, settings.nominatim_url, _country_code(doc, settings))
	pin = _pin_centre((doc.pincode or "").strip(), lookup)
	near = (pin[0], pin[1]) if pin else None

	result, status = None, "Not Found"
	for query, match_status, skip_coarse in _queries(doc, settings.country, pin[3] if pin else ""):
		result = geocode(query, *lookup, near=near, max_km=PIN_RADIUS_KM, skip_coarse=skip_coarse)
		if result:
			status = match_status
			break
	if not result and pin:
		result, status = pin[:3], "Approximate"

	values = {"geocode_status": status, "geocoded_on": now_datetime(), "location_set_by": None}
	if result:
		values.update(latitude=result[0], longitude=result[1])
	doc.flags.rm_geocoding = True
	doc.db_set(values, update_modified=False)
	# The lookup runs in the background; tell an open Address form to show the result.
	frappe.publish_realtime(
		"rm_address_located",
		{"address": doc.name, "status": status},
		doctype="Address",
		docname=doc.name,
		after_commit=True,
	)
	return status


def geocode_pending(limit=20):
	"""
	Locate a batch of addresses that have never been looked up (the
	"Locate All" button runs this repeatedly; see tasks.py).

	Returns:
	        dict: counts by resulting status, plus "errors".
	"""
	names = frappe.get_all(
		"Address",
		filters={"geocode_status": ["in", ["", None]], "disabled": 0},
		pluck="name",
		limit=limit,
		order_by="creation desc",
	)
	counts = {"Located": 0, "Approximate": 0, "Not Found": 0, "errors": 0}
	for name in names:
		try:
			status = geocode_address(name)
		except GeocodingError:
			counts["errors"] += 1
			continue
		counts[status] = counts.get(status, 0) + 1
		frappe.db.commit()  # keep progress if the job is stopped part-way
	return counts


def _queries(doc, default_country, district=""):
	"""
	Most precise first: the full address, then each address line (and each
	comma-separated part of it, "MG Road, Andheri East" -> "Andheri East") as a
	locality with the city and PIN, then with the PIN code's district
	("Kalkulam, Kanniyakumari"), then the city itself. Fallbacks leave out the
	state, whose spelling varies ("tamilnadu", "Tamilnadu/Kanyakumari"). The
	PIN code's centre is the last resort (see geocode_address).

	Returns:
	        list: (query, status, skip_coarse). skip_coarse is set on the city-only
	        query: a village or town there is useful, a whole city like Mumbai is not.
	"""
	country = doc.country or default_country
	full = ", ".join(p for p in [doc.address_line1, doc.address_line2, doc.city, doc.state, doc.pincode, country] if p)
	candidates = [(full, "Located", False)]
	localities = []
	for line in (doc.address_line2, doc.address_line1):
		if not line:
			continue
		parts = [p.strip() for p in line.split(",") if p.strip()]
		# The whole line, then its parts from the last: area names usually come after the street.
		for locality in [line.strip()] + parts[::-1] if len(parts) > 1 else [line.strip()]:
			if locality not in localities:
				localities.append(locality)
	for locality in localities:
		candidates.append((", ".join(p for p in [locality, doc.city, doc.pincode, country] if p), "Approximate", False))
	if district:
		for locality in localities:
			candidates.append((", ".join(p for p in [locality, district, country] if p), "Approximate", False))
		if doc.city:
			candidates.append((", ".join([doc.city, district, country]), "Approximate", True))

	queries, seen = [], set()
	for query, status, skip_coarse in candidates:
		if query and query not in seen:
			seen.add(query)
			queries.append((query, status, skip_coarse))
	return queries


def _pin_centre(pincode, lookup):
	"""
	locate_postcode, cached: shops share PIN codes, and each lookup costs about
	a second on the rate-limited public OpenStreetMap server.
	"""
	if not pincode:
		return None
	provider, _key, _url, country_code = lookup
	cache_key = f"rm_pin_centre:{provider}:{country_code}:{pincode}"
	cached = frappe.cache.get_value(cache_key)
	if cached:
		return tuple(cached)
	pin = locate_postcode(pincode, *lookup)
	if pin:
		frappe.cache.set_value(cache_key, list(pin), expires_in_sec=PIN_CACHE_SECONDS)
	return pin


def _country_code(doc, settings):
	if doc.country and doc.country != settings.country:
		return (frappe.db.get_value("Country", doc.country, "code") or "").lower() or None
	return settings.country_code or None
