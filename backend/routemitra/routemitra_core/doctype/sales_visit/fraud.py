# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""
Signs that a check-in or check-out was faked. None of these prove fraud on
their own; they flag the visit so a manager reviews it.
"""

import frappe
from frappe import _
from frappe.utils import add_days, flt, get_datetime, getdate, now_datetime, time_diff_in_seconds

from routemitra.routemitra_core.customer_locations import get_customer_point
from routemitra.utils.geo import distance_m

MIN_REAL_ACCURACY_M = 3  # phones rarely report better than this; fake-GPS apps often do
SAME_SPOT_M = 30  # two check-ins this close were made from the same place
SEPARATE_SHOPS_M = 300  # ...which is suspicious when the two shops are at least this far apart
SELF_LOCATED_DAYS = 30  # a shop pin the rep moved recently makes their check-ins there suspect
MIN_TRAVEL_KM = 1  # ignore speed on short hops, where GPS error dominates
COORDINATE_TOLERANCE = 0.0000005  # below the 6th decimal place: an exact repeat
UNCLOSED_LOOKBACK_DAYS = 3


def checkin_flags(visit, accuracy, settings):
	"""
	Reasons to doubt a new check-in.

	Parameters:
	        visit (Document, required): Unsaved Sales Visit with check-in fields set.
	        accuracy (float, required): GPS accuracy exactly as the browser reported it.
	        settings (frappe._dict, required): From get_settings().

	Returns:
	        list: Human-readable reasons, empty when nothing looks wrong.
	"""
	flags = []
	if visit.status == "Outside Radius":
		flags.append(_("Checked in {0} m from the shop.").format(visit.distance_m))
	elif visit.status == "Customer Not Located":
		flags.append(_("The shop has no location on record, so the check-in can't be verified."))
	flags += _accuracy_flags(accuracy, _("check-in"))
	flags += _mock_flags(visit, _("check-in"))
	flags += _travel_flags(visit, settings)
	flags += _repeated_coordinate_flags(visit)
	flags += _same_spot_flags(visit)
	flags += _self_located_flags(visit)
	flags += _photo_flags(visit)
	return flags


def checkout_flags(visit, accuracy, settings):
	"""
	Reasons to doubt a check-out: too short a stay, or not at the shop when leaving.

	Parameters:
	        visit (Document, required): Sales Visit with check-out fields set.
	        accuracy (float, required): GPS accuracy exactly as the browser reported it.
	        settings (frappe._dict, required): From get_settings().

	Returns:
	        list: Human-readable reasons.
	"""
	flags = []
	if settings.min_visit_minutes and visit.duration_minutes < settings.min_visit_minutes:
		flags.append(
			_("Only {0} minutes at the shop (minimum {1}).").format(visit.duration_minutes, settings.min_visit_minutes)
		)
	located = visit.customer_latitude and visit.customer_longitude
	if located and visit.checkout_distance_m > allowance_m(settings, accuracy):
		flags.append(_("Checked out {0} m from the shop.").format(visit.checkout_distance_m))
	flags += _accuracy_flags(accuracy, _("check-out"))
	flags += _mock_flags(visit, _("check-out"))
	return flags


def allowance_m(settings, accuracy):
	"""Check-in radius plus GPS accuracy, capped at 100 m so a poor fix can't verify anything."""
	return settings.checkin_radius + min(flt(accuracy), 100)


def add_flags(visit, flags):
	"""Append reasons to the visit and send it (back) to review."""
	if not flags:
		return
	existing = [line for line in (visit.fraud_flags or "").splitlines() if line]
	visit.fraud_flags = "\n".join(existing + [f for f in flags if f not in existing])
	visit.is_suspicious = 1
	visit.review_status = "Pending Review"


def flag_unclosed_visits():
	"""
	Daily job: flag visits from before today that were never checked out.
	A rep who checks in and leaves without checking out hides how long they stayed.
	"""
	reason = _("Never checked out.")
	today = getdate()
	names = frappe.get_all(
		"Sales Visit",
		filters={
			"checkout_time": ["is", "not set"],
			# A few days back covers a missed scheduler run without sweeping up history.
			"checkin_time": ["between", [add_days(today, -UNCLOSED_LOOKBACK_DAYS), add_days(today, -1)]],
		},
		pluck="name",
	)
	for name in names:
		visit = frappe.get_doc("Sales Visit", name)
		if reason in (visit.fraud_flags or ""):
			continue
		add_flags(visit, [reason])
		visit.flags.from_checkin = True
		visit.save(ignore_permissions=True)


def _accuracy_flags(accuracy, stage):
	if flt(accuracy) < MIN_REAL_ACCURACY_M:
		return [
			_("GPS accuracy at {0} was {1} m, better than phones achieve. Fake-GPS apps often report this.").format(
				stage, flt(accuracy, 1)
			)
		]
	return []


def _travel_flags(visit, settings):
	"""Could the rep have got here from their previous visit at a realistic speed?"""
	previous = frappe.db.sql(
		"""
		select name, customer_name,
			coalesce(checkout_time, checkin_time) as at_time,
			coalesce(nullif(checkout_latitude, 0), checkin_latitude) as lat,
			coalesce(nullif(checkout_longitude, 0), checkin_longitude) as lng
		from `tabSales Visit`
		where owner = %s and checkin_time >= %s
		order by checkin_time desc
		limit 1
		""",
		(visit.owner or frappe.session.user, add_days(now_datetime(), -1)),
		as_dict=True,
	)
	if not previous or not (flt(previous[0].lat) and flt(previous[0].lng)):
		return []
	prev = previous[0]
	km = distance_m(flt(prev.lat), flt(prev.lng), visit.checkin_latitude, visit.checkin_longitude) / 1000
	if km < MIN_TRAVEL_KM:
		return []
	hours = max(time_diff_in_seconds(visit.checkin_time, get_datetime(prev.at_time)), 60) / 3600
	speed = km / hours
	if speed <= settings.max_travel_speed_kmh:
		return []
	return [
		_("Travelled {0} km in {1} minutes since {2} ({3}), about {4} km/h.").format(
			round(km, 1), round(hours * 60), prev.name, prev.customer_name, round(speed)
		)
	]


def _repeated_coordinate_flags(visit):
	"""Real GPS readings almost never repeat to the 6th decimal place; replayed or typed ones do."""
	lat, lng = visit.checkin_latitude, visit.checkin_longitude
	match = frappe.db.sql(
		"""
		select name from `tabSales Visit`
		where checkin_latitude between %(lat_lo)s and %(lat_hi)s
			and checkin_longitude between %(lng_lo)s and %(lng_hi)s
		limit 1
		""",
		{
			"lat_lo": lat - COORDINATE_TOLERANCE, "lat_hi": lat + COORDINATE_TOLERANCE,
			"lng_lo": lng - COORDINATE_TOLERANCE, "lng_hi": lng + COORDINATE_TOLERANCE,
		},
	)
	if match:
		return [_("Exactly the same coordinates as {0}. Real GPS readings almost never repeat.").format(match[0][0])]
	return []


def _same_spot_flags(visit):
	"""Checked in at far-apart shops from one spot: at least one shop's pin is wrong or was moved."""
	if not (visit.customer_latitude and visit.customer_longitude):
		return []
	today = frappe.get_all(
		"Sales Visit",
		filters={"owner": visit.owner or frappe.session.user, "checkin_time": [">=", getdate()], "customer": ["!=", visit.customer]},
		fields=["name", "customer_name", "checkin_latitude", "checkin_longitude", "customer_latitude", "customer_longitude"],
	)
	flags = []
	for other in today:
		if not (other.customer_latitude and other.customer_longitude):
			continue
		same_spot = distance_m(visit.checkin_latitude, visit.checkin_longitude, other.checkin_latitude, other.checkin_longitude) <= SAME_SPOT_M
		shops_apart = distance_m(visit.customer_latitude, visit.customer_longitude, other.customer_latitude, other.customer_longitude)
		if same_spot and shops_apart >= SEPARATE_SHOPS_M:
			flags.append(
				_("Checked in from the same spot as {0} ({1}), but the two shops are {2} m apart.").format(
					other.name, other.customer_name, round(shops_apart)
				)
			)
	return flags


def _self_located_flags(visit):
	"""The rep moved this shop's pin themselves recently, so a Verified check-in proves little."""
	point = get_customer_point(visit.customer)
	if not point:
		return []
	address = frappe.db.get_value(
		"Address", point[2], ["geocode_status", "location_set_by", "geocoded_on"], as_dict=True
	)
	if not address or address.geocode_status not in ("GPS", "Manual"):
		return []
	if address.location_set_by != (visit.owner or frappe.session.user):
		return []
	if address.geocoded_on and get_datetime(address.geocoded_on) < add_days(now_datetime(), -SELF_LOCATED_DAYS):
		return []
	return [
		_("This sales person set the shop's location themselves on {0}.").format(
			frappe.format(address.geocoded_on, {"fieldtype": "Datetime"})
		)
	]


def _mock_flags(visit, action):
	"""The RouteMitra mobile app reported that the phone's position came from a fake-GPS app."""
	if visit.flags.is_mocked:
		return [_("The phone reported a mock (fake GPS) location at {0}.").format(action)]
	return []


def _photo_flags(visit):
	"""The photo didn't come from the live camera, or the same image was already used for another visit."""
	if not visit.photo_hash:
		return []
	flags = []
	# Client-reported, so it catches the app's file-picker path, not a hand-crafted request.
	if visit.flags.photo_source != "camera":
		flags.append(_("The shop photo was picked from a file, not taken with the live camera."))
	other = frappe.db.get_value("Sales Visit", {"photo_hash": visit.photo_hash}, "name")
	if other:
		flags.append(_("The shop photo is the same image as {0}'s.").format(other))
	return flags
