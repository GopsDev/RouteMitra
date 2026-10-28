# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""Where each customer is, plus the sales numbers the map colours pins by."""

import frappe
from frappe.utils import add_days, flt, getdate, nowdate

from routemitra.utils.geo import distance_m

SALES_WINDOW_DAYS = 90


def get_customer_point(customer):
	"""
	(latitude, longitude, address name) of a customer's best located address:
	the primary address if it has coordinates, else primary/shipping flags, else any.

	Returns:
	        tuple or None
	"""
	points = _points_for([customer])
	return points.get(customer)


def get_map_data(territory=None, sales_person=None, only=None):
	"""
	Every located customer the user may see, with metrics for colouring.

	Parameters:
	        territory (str, optional): Include this territory and its children.
	        sales_person (str, optional): Only customers in this person's sales team.
	        only (list, optional): Restrict to these customer names.

	Returns:
	        dict: {"customers": [...], "unlocated": int}
	"""
	customers = _visible_customers(territory, sales_person, only)
	names = [c.name for c in customers]
	points = _points_for(names)
	outstanding, sales, last_visit = _metrics([n for n in names if n in points])

	located = []
	for customer in customers:
		point = points.get(customer.name)
		if not point:
			continue
		visited = last_visit.get(customer.name)
		located.append({
			"customer": customer.name,
			"customer_name": customer.customer_name,
			"territory": customer.territory,
			"customer_group": customer.customer_group,
			"lat": point[0],
			"lng": point[1],
			"address": point[2],
			"outstanding": flt(outstanding.get(customer.name)),
			"sales_90d": flt(sales.get(customer.name)),
			"last_visit": str(visited) if visited else None,
			"days_since_visit": (getdate(nowdate()) - getdate(visited)).days if visited else None,
		})
	return {"customers": located, "unlocated": len(customers) - len(located)}


def get_nearby(lat, lng, radius_km=5, limit=20):
	"""
	Located customers within `radius_km`, closest first, least recently
	visited breaking ties. A rep only gets their own shops (see _nearby_scope),
	and shops the user already visited today are left out.

	Returns:
	        list: customer dicts from get_map_data plus "distance_km".
	"""
	lat, lng, radius_m = flt(lat), flt(lng), flt(radius_km) * 1000
	only = _nearby_scope()
	if only is not None and not only:
		return []
	visited_today = set(frappe.get_all(
		"Sales Visit",
		filters={"owner": frappe.session.user, "checkin_time": [">=", getdate()]},
		pluck="customer",
	))
	rows = []
	for row in get_map_data(only=only)["customers"]:
		if row["customer"] in visited_today:
			continue
		metres = distance_m(lat, lng, row["lat"], row["lng"])
		if metres <= radius_m:
			rows.append({**row, "distance_km": round(metres / 1000, 2)})
	rows.sort(key=lambda r: (r["distance_km"], -(r["days_since_visit"] if r["days_since_visit"] is not None else 10**6)))
	return rows[: int(limit)]


def _nearby_scope():
	"""
	Customer names a rep may find nearby: those whose Sales Team includes the rep's
	Sales Person, plus any on the rep's Beat Plans for today. None for managers (everyone).
	"""
	from routemitra.routemitra_core.doctype.sales_visit.checkin import own_sales_person
	from routemitra.routemitra_core.field_access import is_manager

	if is_manager():
		return None
	sales_person = own_sales_person()
	if not sales_person:
		return []
	assigned = frappe.get_all("Sales Team", {"parenttype": "Customer", "sales_person": sales_person}, pluck="parent")
	plans = frappe.get_all("Beat Plan", {"sales_person": sales_person, "plan_date": getdate()}, pluck="name")
	on_plan = frappe.get_all("Beat Plan Stop", {"parenttype": "Beat Plan", "parent": ["in", plans]}, pluck="customer") if plans else []
	return list(set(assigned) | set(on_plan))


def _visible_customers(territory, sales_person, only=None):
	"""Customers the current user can read, after the optional filters."""
	filters = {"disabled": 0}
	if only is not None:
		filters["name"] = ["in", only or [""]]
	if territory:
		lft, rgt = frappe.db.get_value("Territory", territory, ["lft", "rgt"])
		filters["territory"] = ["in", frappe.get_all("Territory", {"lft": [">=", lft], "rgt": ["<=", rgt]}, pluck="name")]
	if sales_person:
		filters["name"] = ["in", frappe.get_all(
			"Sales Team", {"parenttype": "Customer", "sales_person": sales_person}, pluck="parent"
		) or [""]]
	return frappe.get_list(
		"Customer", filters=filters, fields=["name", "customer_name", "territory", "customer_group", "customer_primary_address"],
		limit_page_length=0,
	)


def _points_for(customers):
	"""{customer: (lat, lng, address)} using the best located linked address."""
	if not customers:
		return {}
	rows = frappe.db.sql(
		"""
		select dl.link_name as customer, a.name as address, a.latitude, a.longitude
		from `tabAddress` a
		join `tabDynamic Link` dl on dl.parent = a.name and dl.parenttype = 'Address' and dl.link_doctype = 'Customer'
		join `tabCustomer` c on c.name = dl.link_name
		where dl.link_name in %(customers)s and a.disabled = 0
			and ifnull(a.latitude, 0) != 0 and ifnull(a.longitude, 0) != 0
		order by (a.name = c.customer_primary_address) desc, a.is_primary_address desc, a.is_shipping_address desc, a.modified desc
		""",
		{"customers": tuple(customers)},
		as_dict=True,
	)
	points = {}
	for row in rows:
		points.setdefault(row.customer, (flt(row.latitude), flt(row.longitude), row.address))
	return points


def _metrics(customers):
	"""(outstanding, sales in the last 90 days, last visit time) per customer."""
	if not customers:
		return {}, {}, {}
	params = {"customers": tuple(customers), "since": add_days(nowdate(), -SALES_WINDOW_DAYS)}
	outstanding = dict(frappe.db.sql(
		"""select customer, sum(outstanding_amount) from `tabSales Invoice`
		where docstatus = 1 and customer in %(customers)s group by customer""",
		params,
	))
	sales = dict(frappe.db.sql(
		"""select customer, sum(base_grand_total) from `tabSales Invoice`
		where docstatus = 1 and is_return = 0 and posting_date >= %(since)s and customer in %(customers)s group by customer""",
		params,
	))
	last_visit = dict(frappe.db.sql(
		"""select customer, max(checkin_time) from `tabSales Visit`
		where docstatus < 2 and customer in %(customers)s group by customer""",
		params,
	))
	return outstanding, sales, last_visit
