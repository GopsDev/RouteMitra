# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class RouteMitraSettings(Document):
	pass


def get_settings():
	"""
	Settings with defaults filled in and the Google key decrypted.

	Returns:
	        frappe._dict: provider, google_api_key, nominatim_url, auto_geocode,
	        country_code, map centre/zoom, checkin_radius (metres) and the
	        visit verification rules (require_photo, min_visit_minutes, max_travel_speed_kmh)
	        and the mobile app's download link (android_app_url).
	"""
	doc = frappe.get_cached_doc("RouteMitra Settings")
	country = doc.default_country or "India"
	return frappe._dict(
		provider=doc.geocoding_provider or "OpenStreetMap",
		google_api_key=doc.get_password("google_api_key", raise_exception=False) if doc.google_api_key else None,
		nominatim_url=doc.nominatim_url or "https://nominatim.openstreetmap.org",
		auto_geocode=bool(doc.auto_geocode),
		country=country,
		country_code=(frappe.db.get_value("Country", country, "code") or "").lower(),
		default_latitude=doc.default_latitude or 8.1833,
		default_longitude=doc.default_longitude or 77.4119,
		default_zoom=doc.default_zoom or 12,
		checkin_radius=doc.checkin_radius or 150,
		require_photo=bool(doc.require_photo),
		min_visit_minutes=doc.min_visit_minutes or 0,
		max_travel_speed_kmh=doc.max_travel_speed_kmh or 80,
		android_app_url=doc.android_app_url or None,
	)


def get_test_location():
	"""
	The fake GPS position for testing on a laptop, only in developer mode.

	Returns:
	        dict or None: {"lat", "lng"} when Use Test Location is on, else None.
	"""
	if not frappe.conf.developer_mode:
		return None
	doc = frappe.get_cached_doc("RouteMitra Settings")
	if not (doc.use_test_location and doc.test_latitude and doc.test_longitude):
		return None
	return {"lat": doc.test_latitude, "lng": doc.test_longitude}


def boot_session(bootinfo):
	"""Tell the Desk whether this user is a field rep (frappe.boot.rm_field_only), so it can send them to the mobile page."""
	# Imported here: field_access imports checkin, which imports this module.
	from routemitra.routemitra_core.field_access import is_field_rep

	bootinfo.rm_field_only = is_field_rep()
