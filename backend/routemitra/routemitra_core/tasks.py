# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""Background jobs (frappe.enqueue targets)."""

import frappe

from routemitra.routemitra_core.customization.address.geocoding import geocode_address as _geocode_address
from routemitra.routemitra_core.customization.address.geocoding import geocode_pending
from routemitra.utils.geo import GeocodingError


def geocode_address(address):
	"""Locate one Address; provider errors are logged, not raised."""
	try:
		_geocode_address(address)
	except GeocodingError:
		frappe.log_error(title=f"RouteMitra: could not locate {address}")


BATCH_TASK = "routemitra.routemitra_core.tasks.geocode_pending_addresses"


def geocode_pending_addresses(totals=None):
	"""
	Locate never-looked-up addresses in small batches. Each batch queues the
	next, so a newly saved address (short queue) runs in between instead of
	waiting behind a bulk run of hundreds. Tells the user when done.

	Parameters:
	        totals (dict, optional): Counts carried over from earlier batches.
	"""
	counts = geocode_pending()
	totals = {key: (totals or {}).get(key, 0) + counts.get(key, 0) for key in set(counts) | set(totals or {})}

	progressed = sum(v for k, v in counts.items() if k != "errors")
	remaining = frappe.db.count("Address", {"geocode_status": ["in", ["", None]], "disabled": 0})
	if remaining and progressed:
		frappe.enqueue(BATCH_TASK, queue="long", timeout=900, totals=totals, enqueue_after_commit=True)
		return
	frappe.publish_realtime("rm_geocoding_done", totals, user=frappe.session.user, after_commit=True)
