# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""Endpoints for the sales rep's mobile page (/routemitra)."""

import frappe
from frappe import _
from frappe.utils import getdate, nowdate

from routemitra.routemitra_core.doctype.routemitra_settings.routemitra_settings import (
	get_settings,
	get_test_location,
)
from routemitra.routemitra_core.doctype.sales_visit.checkin import own_sales_person
from routemitra.routemitra_core.field_access import is_manager
from routemitra.routemitra_core.notifications import FIELD_DOCTYPES, recent_for_field_app

OUTCOMES = ("Order Taken", "Follow-up Needed", "Payment Collected", "No Order", "Shop Closed")
SKIP_REASONS = ("Shop closed", "Owner not available", "Ran out of time", "Shop moved or not found", "Other")


@frappe.whitelist()
def get_field_day():
	"""
	Everything the mobile page shows: today's Beat Plan stops, the open visit and today's visits.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.field.get_field_day
	HTTP Method: GET
	Response: {"message": {"user_name": "...", "sales_person": "...", "is_manager": false, "plans": [...],
	        "open_visit": {...} | null, "visits": [...], "notifications": [...], "settings": {...}}}
	"""
	frappe.has_permission("Sales Visit", "create", throw=True)
	settings = get_settings()
	sales_person = own_sales_person()
	visits = frappe.get_all(
		"Sales Visit",
		filters={"owner": frappe.session.user, "checkin_time": [">=", getdate()]},
		fields=[
			"name", "customer", "customer_name", "status", "distance_m", "checkin_time", "checkout_time",
			"duration_minutes", "outcome", "notes", "is_suspicious", "beat_plan", "sales_order", "photo",
		],
		order_by="checkin_time desc",
	)
	add_order_totals(visits)
	return {
		"user": frappe.session.user,
		"user_name": frappe.utils.get_fullname(frappe.session.user),
		"sales_person": sales_person,
		"today": nowdate(),
		"is_manager": is_manager(),
		"plans": _plans(sales_person),
		"open_visit": next((v for v in visits if not v.checkout_time), None),
		"visits": visits,
		"outcomes": OUTCOMES,
		"skip_reasons": SKIP_REASONS,
		"notifications": recent_for_field_app(),
		"settings": {
			"require_photo": settings.require_photo,
			"checkin_radius": settings.checkin_radius,
			"min_visit_minutes": settings.min_visit_minutes,
			"test_location": get_test_location(),
		},
	}


@frappe.whitelist(methods=["POST"])
def save_visit_outcome(sales_visit: str, outcome: str | None = None, notes: str | None = None):
	"""
	Record what happened at the shop, on the rep's own visit.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.field.save_visit_outcome
	HTTP Method: POST
	Parameters:
	        - sales_visit (str, required): The rep's own visit.
	        - outcome (str, optional): One of OUTCOMES.
	        - notes (str, optional): Free text.
	Response: {"message": {"sales_visit": "VISIT-2026-00001"}}
	"""
	visit = frappe.get_doc("Sales Visit", sales_visit)
	if visit.owner != frappe.session.user:
		frappe.throw(_("You can only update your own visits."), frappe.PermissionError)
	if outcome and outcome not in OUTCOMES:
		frappe.throw(_("Unknown outcome: {0}").format(outcome))
	visit.outcome = outcome or None
	visit.notes = notes
	visit.save()
	return {"sales_visit": visit.name}


@frappe.whitelist(methods=["POST"])
def skip_stop(beat_plan: str, customer: str, reason: str, note: str | None = None):
	"""
	The rep can't visit a shop on today's route: mark the stop Skipped, with why.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.field.skip_stop
	HTTP Method: POST
	Parameters:
	        - beat_plan (str, required): The rep's own Beat Plan for today.
	        - customer (str, required): The stop's customer; the stop must still be Planned.
	        - reason (str, required): One of SKIP_REASONS.
	        - note (str, optional): Free text, kept with the reason.
	Response: {"message": {"beat_plan": "BEAT-2026-00001", "customer": "..."}}
	"""
	if reason not in SKIP_REASONS:
		frappe.throw(_("Choose why the shop is being skipped."))
	plan = frappe.get_doc("Beat Plan", beat_plan)
	if plan.sales_person != own_sales_person() and not is_manager():
		frappe.throw(_("{0} belongs to another sales person.").format(beat_plan), frappe.PermissionError)
	if getdate(plan.plan_date) != getdate():
		frappe.throw(_("Only today's route can be changed."))
	stop = next((s for s in plan.stops if s.customer == customer), None)
	if not stop or stop.status != "Planned":
		frappe.throw(_("{0} isn't a planned stop on {1}.").format(customer, beat_plan))
	stop.status = "Skipped"
	stop.skip_reason = f"{reason}: {note.strip()}" if note and note.strip() else reason
	plan.save(ignore_permissions=True)  # checked above: the rep's own plan
	return {"beat_plan": plan.name, "customer": customer}


@frappe.whitelist()
def get_notifications():
	"""
	The rep's RouteMitra notifications from the last week, newest first, read ones included.
	The mobile page polls this while open.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.field.get_notifications
	HTTP Method: GET
	Response: {"message": [{"name": "...", "subject": "...", "document_type": "Beat Plan", "read": 0, ...}]}
	"""
	return recent_for_field_app()


@frappe.whitelist(methods=["POST"])
def mark_notifications_read(names: str | list | None = None):
	"""
	Mark the rep's RouteMitra notifications read on the mobile page (all of them when no names are given).
	They stay in the Updates list, faded.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.field.mark_notifications_read
	HTTP Method: POST
	Parameters:
	        - names (list, optional): Notification Log names.
	Response: {"message": {"marked": 2}}
	"""
	filters = {"for_user": frappe.session.user, "read": 0, "document_type": ["in", FIELD_DOCTYPES]}
	if names:
		filters["name"] = ["in", frappe.parse_json(names) if isinstance(names, str) else names]
	logs = frappe.get_all("Notification Log", filters=filters, pluck="name")
	for name in logs:
		frappe.db.set_value("Notification Log", name, "read", 1, update_modified=False)
	return {"marked": len(logs)}


def add_order_totals(visits):
	"""Put the linked Sales Order's grand total and currency on each visit, for the order chip."""
	orders = [v.sales_order for v in visits if v.sales_order]
	totals = {}
	if orders:
		for row in frappe.get_all(
			"Sales Order", filters={"name": ["in", orders]}, fields=["name", "grand_total", "currency"]
		):
			totals[row.name] = row
	for visit in visits:
		order = totals.get(visit.sales_order)
		visit.order_total = order.grand_total if order else None
		visit.order_currency = order.currency if order else None


def _plans(sales_person):
	"""Today's Beat Plans for this sales person, with each stop's address and location."""
	if not sales_person:
		return []
	plans = frappe.get_list(
		"Beat Plan",
		filters={"sales_person": sales_person, "plan_date": getdate()},
		fields=["name", "total_stops", "visited_stops", "total_distance_km"],
		order_by="creation asc",
	)
	for plan in plans:
		plan.stops = frappe.get_all(
			"Beat Plan Stop",
			filters={"parent": plan.name, "parenttype": "Beat Plan"},
			fields=["idx", "customer", "customer_name", "status", "skip_reason", "latitude", "longitude", "sales_visit"],
			order_by="idx asc",
		)
		addresses = _addresses([s.customer for s in plan.stops])
		images = customer_images([s.customer for s in plan.stops])
		for stop in plan.stops:
			stop.address = addresses.get(stop.customer)
			stop.image = images.get(stop.customer)
	return plans


def customer_images(customers):
	"""
	Each shop's picture for the rep: the Customer's Image field, only when it is filled.

	Returns:
	        dict: {customer: file URL}; customers with no image are left out.
	"""
	if not customers:
		return {}
	rows = frappe.get_all(
		"Customer", filters={"name": ["in", customers], "image": ["is", "set"]}, fields=["name", "image"]
	)
	return {row.name: row.image for row in rows}


def _addresses(customers):
	"""{customer: "line 1, city"} from each customer's primary (or any) address."""
	if not customers:
		return {}
	rows = frappe.db.sql(
		"""
		select dl.link_name as customer, a.address_line1, a.city
		from `tabAddress` a
		join `tabDynamic Link` dl on dl.parent = a.name and dl.parenttype = 'Address' and dl.link_doctype = 'Customer'
		join `tabCustomer` c on c.name = dl.link_name
		where dl.link_name in %(customers)s and a.disabled = 0
		order by (a.name = c.customer_primary_address) desc, a.is_primary_address desc, a.modified desc
		""",
		{"customers": tuple(customers)},
		as_dict=True,
	)
	result = {}
	for row in rows:
		parts = [row.address_line1]
		if row.city and row.city.strip().lower() not in (row.address_line1 or "").lower():
			parts.append(row.city)
		result.setdefault(row.customer, ", ".join(p for p in parts if p))
	return result
