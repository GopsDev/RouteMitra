# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""
RouteMitra notifications: a route assigned to a rep, a visit approved or rejected,
stops missed. They are Frappe Notification Logs of type "Alert" (the Desk bell,
never email), and the mobile page shows the rep's unread ones too.
"""

import frappe
from frappe import _
from frappe.desk.doctype.notification_log.notification_log import enqueue_create_notification
from frappe.utils import add_days, format_date, get_fullname, getdate, now_datetime

# Documents whose notifications the mobile page shows.
FIELD_DOCTYPES = ("Beat Plan", "Sales Visit")
UPDATES_DAYS = 7  # the mobile page keeps a week of updates, read or not
MISSED_LOOKBACK_DAYS = 30  # older planned stops are left alone
NOTIFY_MISSED_DAYS = 3  # only recent misses are worth telling anyone about


def notify_plan_assigned(plan):
	"""Tell the rep about a route planned for them (new, moved to them, or moved to another day)."""
	user = user_for_sales_person(plan.sales_person)
	if not user or user == frappe.session.user or getdate(plan.plan_date) < getdate():
		return
	_notify(
		user,
		_("New route for {0}: {1} shops ({2}), planned by {3}.").format(
			format_date(plan.plan_date, "EEE, d MMM"), len(plan.stops), plan.name, get_fullname(frappe.session.user)
		),
		"Beat Plan",
		plan.name,
	)


def notify_plan_updated(plan, before):
	"""
	Tell the rep when shops were added to or removed from a route they already have,
	e.g. "Route for Thu, 9 Oct (BP-0012) updated by Ravi: added Anbu Stores; removed Lakshmi Medicals."
	"""
	user = user_for_sales_person(plan.sales_person)
	if not user or user == frappe.session.user or getdate(plan.plan_date) < getdate():
		return

	old_customers = {stop.customer for stop in before.stops}
	new_customers = {stop.customer for stop in plan.stops}
	added = [stop.customer_name or stop.customer for stop in plan.stops if stop.customer not in old_customers]
	removed = [stop.customer_name or stop.customer for stop in before.stops if stop.customer not in new_customers]
	if not added and not removed:
		return

	changes = []
	if added:
		changes.append(_("added {0}").format(", ".join(added)))
	if removed:
		changes.append(_("removed {0}").format(", ".join(removed)))
	_notify(
		user,
		_("Route for {0} ({1}) updated by {2}: {3}.").format(
			format_date(plan.plan_date, "EEE, d MMM"), plan.name, get_fullname(frappe.session.user), "; ".join(changes)
		),
		"Beat Plan",
		plan.name,
	)


def notify_visit_reviewed(visit):
	"""Tell the rep their flagged visit was approved or rejected, with the manager's notes."""
	if visit.owner == frappe.session.user:
		return
	date = format_date(visit.checkin_time, "d MMM")
	who = get_fullname(frappe.session.user)
	if visit.review_status == "Approved":
		subject = _("Your visit to {0} on {1} was approved by {2}.").format(visit.customer_name, date, who)
	else:
		subject = _("Your visit to {0} on {1} was rejected by {2}.").format(visit.customer_name, date, who)
	if visit.review_notes:
		subject += " " + _("Note: {0}").format(visit.review_notes)
	_notify(visit.owner, subject, "Sales Visit", visit.name)


def mark_missed_stops():
	"""
	Daily job: stops still Planned on a past day's Beat Plan become Missed.
	Whoever planned a route that was (partly) missed recently is told.
	"""
	today = getdate()
	rows = frappe.db.sql(
		"""
		select s.name as stop, s.customer_name, bp.name as plan, bp.plan_date, bp.sales_person, bp.owner
		from `tabBeat Plan Stop` s
		join `tabBeat Plan` bp on bp.name = s.parent and s.parenttype = 'Beat Plan'
		where s.status = 'Planned' and bp.plan_date < %(today)s and bp.plan_date >= %(since)s
		order by bp.plan_date, s.idx
		""",
		{"today": today, "since": add_days(today, -MISSED_LOOKBACK_DAYS)},
		as_dict=True,
	)
	plans = {}
	for row in rows:
		frappe.db.set_value("Beat Plan Stop", row.stop, "status", "Missed", update_modified=False)
		plans.setdefault(row.plan, row).setdefault("missed", []).append(row.customer_name)

	for plan, row in plans.items():
		if getdate(row.plan_date) < add_days(today, -NOTIFY_MISSED_DAYS):
			continue
		if row.owner == user_for_sales_person(row.sales_person):
			continue  # the rep planned it themselves; the Missed Visits report shows it
		_notify(
			row.owner,
			_("{0} missed {1} shop(s) on {2} ({3}): {4}").format(
				row.sales_person, len(row.missed), format_date(row.plan_date, "d MMM"), plan, ", ".join(row.missed)
			),
			"Beat Plan",
			plan,
			from_user="Administrator",
		)
	return len(rows)


def recent_for_field_app(user=None, limit=20):
	"""
	The rep's RouteMitra notifications from the last week, newest first, for the mobile page.
	Read ones stay in the list (shown faded); only unread ones light the bell.
	"""
	return frappe.get_all(
		"Notification Log",
		filters={
			"for_user": user or frappe.session.user,
			"document_type": ["in", FIELD_DOCTYPES],
			"creation": [">=", add_days(now_datetime(), -UPDATES_DAYS)],
		},
		fields=["name", "subject", "document_type", "document_name", "creation", "read"],
		order_by="creation desc",
		limit=limit,
	)


def user_for_sales_person(sales_person):
	"""The login of the rep behind a Sales Person (Sales Person -> Employee -> User), or None."""
	employee = sales_person and frappe.db.get_value("Sales Person", sales_person, "employee")
	return frappe.db.get_value("Employee", employee, "user_id") if employee else None


def _notify(user, subject, doctype, name, from_user=None):
	enqueue_create_notification(
		user,
		{
			"type": "Alert",
			"subject": subject,
			"document_type": doctype,
			"document_name": name,
			"from_user": from_user or frappe.session.user,
		},
	)
