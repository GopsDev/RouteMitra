# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""Whitelisted endpoints for the Customer Map page, Beat Plan and Sales Visit forms."""

import frappe
from frappe.utils import nowdate

from routemitra.routemitra_core import customer_locations
from routemitra.routemitra_core.doctype.routemitra_settings.routemitra_settings import get_settings
from routemitra.routemitra_core.doctype.sales_visit import checkin


@frappe.whitelist()
def get_map_data(territory: str | None = None, sales_person: str | None = None):
	"""
	Located customers (with outstanding, 90-day sales and last visit) and the map defaults.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.maps.get_map_data
	HTTP Method: GET
	Parameters:
	        - territory (str, optional): Territory, including its children.
	        - sales_person (str, optional): Only this person's customers.
	Response: {"message": {"customers": [...], "unlocated": 3, "settings": {...}}}
	"""
	frappe.has_permission("Customer", "read", throw=True)
	data = customer_locations.get_map_data(territory, sales_person)
	settings = get_settings()
	data["settings"] = {
		"lat": settings.default_latitude,
		"lng": settings.default_longitude,
		"zoom": settings.default_zoom,
		"checkin_radius": settings.checkin_radius,
	}
	return data


@frappe.whitelist()
def get_nearby(lat: float, lng: float, radius_km: float = 5, limit: int = 20):
	"""
	Customers near a point (usually the rep's phone), closest first.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.maps.get_nearby
	HTTP Method: GET
	Parameters:
	        - lat, lng (float, required): Current position.
	        - radius_km (float, optional): Search radius, default 5.
	        - limit (int, optional): Maximum results, default 20.
	Response: {"message": [{"customer": "...", "distance_km": 0.8, ...}]}
	"""
	frappe.has_permission("Customer", "read", throw=True)
	return customer_locations.get_nearby(lat, lng, radius_km, limit)


@frappe.whitelist(methods=["POST"])
def locate_pending_addresses():
	"""
	Queue a background lookup of every Address that has never been located.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.maps.locate_pending_addresses
	HTTP Method: POST
	Response: {"message": {"queued": 42}}
	"""
	frappe.has_permission("Address", "write", throw=True)
	pending = frappe.db.count("Address", {"geocode_status": ["in", ["", None]], "disabled": 0})
	if pending:
		frappe.enqueue(
			"routemitra.routemitra_core.tasks.geocode_pending_addresses", queue="long", timeout=3600
		)
	return {"queued": pending}


@frappe.whitelist(methods=["POST"])
def create_beat_plan(sales_person: str, customers: str | list, plan_date: str | None = None):
	"""
	Create a Beat Plan from customers picked on the map, in the shortest order.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.maps.create_beat_plan
	HTTP Method: POST
	Parameters:
	        - sales_person (str, required): Who visits.
	        - customers (list or JSON list, required): Customer names.
	        - plan_date (str, optional): Defaults to today.
	Response: {"message": {"beat_plan": "BEAT-2026-00001"}}
	"""
	frappe.has_permission("Beat Plan", "create", throw=True)
	names = frappe.parse_json(customers) if isinstance(customers, str) else customers
	plan = frappe.new_doc("Beat Plan")
	plan.sales_person = sales_person
	plan.plan_date = plan_date or nowdate()
	for name in names:
		plan.append("stops", {"customer": name})
	plan.insert()
	plan.optimize_route()
	return {"beat_plan": plan.name}


@frappe.whitelist(methods=["POST"])
def optimize_beat_plan(name: str):
	"""
	Reorder a Beat Plan's planned stops by shortest route.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.maps.optimize_beat_plan
	HTTP Method: POST
	Parameters:
	        - name (str, required): Beat Plan.
	Response: {"message": {"total_distance_km": 12.4}}
	"""
	plan = frappe.get_doc("Beat Plan", name)
	plan.check_permission("write")
	plan.optimize_route()
	return {"total_distance_km": plan.total_distance_km}


@frappe.whitelist(methods=["POST"])
def check_in(
	customer: str,
	latitude: float,
	longitude: float,
	accuracy_m: float | None = None,
	beat_plan: str | None = None,
	photo: str | None = None,
	photo_source: str | None = None,
	is_mocked: bool | None = None,
):
	"""
	Record a GPS-verified Sales Visit at a customer. Suspicious check-ins are flagged for review.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.maps.check_in
	HTTP Method: POST
	Parameters:
	        - customer (str, required): Customer visited.
	        - latitude, longitude (float, required): Device position.
	        - accuracy_m (float, required): GPS accuracy in metres; over 1000 m is refused.
	        - beat_plan (str, optional): The rep's own Beat Plan whose stop to tick off.
	        - photo (str, optional): Shop photo as a data URL; required when the settings say so.
	        - photo_source (str, optional): "camera" when taken with the page's live camera; anything else is flagged.
	        - is_mocked (bool, optional): Sent by the mobile app when Android reports a mock location; flagged.
	Response: {"message": {"sales_visit": "VISIT-2026-00001", "status": "Verified", "distance_m": 42, "is_suspicious": 0}}
	"""
	frappe.has_permission("Sales Visit", "create", throw=True)
	visit = checkin.check_in(customer, latitude, longitude, accuracy_m, beat_plan, photo, photo_source, is_mocked)
	return _visit_result(visit)


@frappe.whitelist(methods=["POST"])
def check_out(
	sales_visit: str,
	latitude: float,
	longitude: float,
	accuracy_m: float | None = None,
	is_mocked: bool | None = None,
):
	"""
	Record where and when the rep left the shop, and how long they stayed.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.maps.check_out
	HTTP Method: POST
	Parameters:
	        - sales_visit (str, required): The rep's own open visit.
	        - latitude, longitude (float, required): Device position.
	        - accuracy_m (float, required): GPS accuracy in metres.
	        - is_mocked (bool, optional): Sent by the mobile app when Android reports a mock location; flagged.
	Response: {"message": {"sales_visit": "VISIT-2026-00001", "duration_minutes": 12, "is_suspicious": 0, ...}}
	"""
	visit = checkin.check_out(sales_visit, latitude, longitude, accuracy_m, is_mocked)
	return {**_visit_result(visit), "duration_minutes": visit.duration_minutes}


@frappe.whitelist(methods=["POST"])
def review_visit(sales_visit: str, decision: str, notes: str | None = None):
	"""
	Approve or reject a flagged visit (Sales Manager).

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.maps.review_visit
	HTTP Method: POST
	Parameters:
	        - sales_visit (str, required): Visit to review.
	        - decision (str, required): "Approved" or "Rejected".
	        - notes (str, optional): Reason.
	Response: {"message": {"sales_visit": "VISIT-2026-00001", "review_status": "Approved"}}
	"""
	visit = checkin.review(sales_visit, decision, notes)
	return {"sales_visit": visit.name, "review_status": visit.review_status}


def _visit_result(visit):
	return {
		"sales_visit": visit.name,
		"status": visit.status,
		"distance_m": visit.distance_m,
		"is_suspicious": visit.is_suspicious,
	}
