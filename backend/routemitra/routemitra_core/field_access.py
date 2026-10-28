# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""
Who lands where: field reps work only in the mobile page (/routemitra),
managers and back office work in the Desk.
"""

import frappe

from routemitra.routemitra_core.doctype.sales_visit.checkin import MANAGER_ROLES

FIELD_APP_ROUTE = "routemitra"


def is_field_rep(user=None):
	"""
	A user linked (through Employee) to a Sales Person, without a manager role,
	who may also make visits. Without that permission /routemitra refuses them,
	so they stay in the Desk instead of landing on a "Not Permitted" page.
	"""
	user = user or frappe.session.user
	if user in ("Administrator", "Guest"):
		return False
	if set(MANAGER_ROLES) & set(frappe.get_roles(user)):
		return False
	if not frappe.has_permission("Sales Visit", "create", user=user):
		return False
	return bool(_own_sales_person(user))


def on_login(login_manager):
	"""Send field reps to the mobile page after login instead of the Desk."""
	if is_field_rep(login_manager.user):
		# get_home_page() returns this flag first, so the login response points at the field app.
		frappe.local.flags.home_page = FIELD_APP_ROUTE


def has_app_permission():
	"""Show the RouteMitra app on the apps screen to anyone who can plan or make visits."""
	return bool(frappe.has_permission("Beat Plan", "read") or frappe.has_permission("Sales Visit", "create"))


def is_manager(user=None):
	"""Whether the user sees every rep's plans and visits, and may open the Desk from the mobile page."""
	user = user or frappe.session.user
	return user == "Administrator" or bool(set(MANAGER_ROLES) & set(frappe.get_roles(user)))


def _own_sales_person(user):
	employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
	return frappe.db.get_value("Sales Person", {"employee": employee}, "name") if employee else None


def sales_person_query_conditions(user=None, doctype=None):
	"""
	List filter for Beat Plan and Sales Visit: managers see every rep's records,
	everyone else only their own Sales Person's (nothing when not linked to one).
	"""
	user = user or frappe.session.user
	if is_manager(user):
		return ""
	table = f"`tab{doctype}`"
	sales_person = _own_sales_person(user)
	if not sales_person:
		return "1=0"
	return f"{table}.sales_person = {frappe.db.escape(sales_person)}"


def beat_plan_query_conditions(user=None):
	return sales_person_query_conditions(user, "Beat Plan")


def sales_visit_query_conditions(user=None):
	return sales_person_query_conditions(user, "Sales Visit")


def has_sales_person_permission(doc, ptype=None, user=None):
	"""Single-record check matching the list filter, so another rep's record can't be opened by name."""
	user = user or frappe.session.user
	if is_manager(user) or doc.is_new():
		return True
	return bool(doc.sales_person) and doc.sales_person == _own_sales_person(user)
