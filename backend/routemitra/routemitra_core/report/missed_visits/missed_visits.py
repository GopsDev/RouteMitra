# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""Beat Plan stops that weren't visited (skipped by the rep, or missed), with why, per sales person."""

import frappe
from frappe import _
from frappe.utils import flt

NOT_VISITED = ("Skipped", "Missed")


def execute(filters=None):
	filters = frappe._dict(filters or {})
	stops = _stops(filters)
	wanted = (filters.status,) if filters.status else NOT_VISITED
	rows = [s for s in stops if s.status in wanted]
	return _columns(), rows, None, _chart(stops), _summary(stops)


def _columns():
	return [
		{"fieldname": "plan_date", "label": _("Date"), "fieldtype": "Date", "width": 100},
		{"fieldname": "sales_person", "label": _("Sales Person"), "fieldtype": "Link", "options": "Sales Person", "width": 160},
		{"fieldname": "beat_plan", "label": _("Beat Plan"), "fieldtype": "Link", "options": "Beat Plan", "width": 140},
		{"fieldname": "customer", "label": _("Customer"), "fieldtype": "Link", "options": "Customer", "width": 190},
		{"fieldname": "status", "label": _("Status"), "fieldtype": "Data", "width": 90},
		{"fieldname": "skip_reason", "label": _("Reason"), "fieldtype": "Data", "width": 300},
	]


def _stops(filters):
	"""Every stop on the Beat Plans the user can see in the date range (all statuses, for the totals)."""
	conditions = {"plan_date": ["between", [filters.from_date, filters.to_date]]}
	if filters.sales_person:
		conditions["sales_person"] = filters.sales_person
	plans = {
		p.name: p for p in frappe.get_list("Beat Plan", filters=conditions, fields=["name", "plan_date", "sales_person"])
	}
	if not plans:
		return []
	stops = frappe.get_all(
		"Beat Plan Stop",
		filters={"parenttype": "Beat Plan", "parent": ["in", list(plans)]},
		fields=["parent", "idx", "customer", "status", "skip_reason"],
	)
	for stop in stops:
		plan = plans[stop.parent]
		stop.update(beat_plan=plan.name, plan_date=plan.plan_date, sales_person=plan.sales_person)
	return sorted(stops, key=lambda s: (s.plan_date, s.sales_person or "", s.idx), reverse=True)


def _summary(stops):
	count = lambda status: sum(1 for s in stops if s.status == status)  # noqa: E731
	total, visited = len(stops), count("Visited")
	return [
		{"label": _("Planned Stops"), "value": total, "datatype": "Int"},
		{"label": _("Visited"), "value": visited, "datatype": "Int", "indicator": "Green"},
		{"label": _("Skipped"), "value": count("Skipped"), "datatype": "Int", "indicator": "Orange"},
		{"label": _("Missed"), "value": count("Missed"), "datatype": "Int", "indicator": "Red"},
		{"label": _("Visit Rate"), "value": flt(visited * 100 / total, 1) if total else 0, "datatype": "Percent"},
	]


def _chart(stops):
	people = sorted({s.sales_person or _("Not Set") for s in stops})
	if not people:
		return None

	def series(status):
		return [sum(1 for s in stops if (s.sales_person or _("Not Set")) == p and s.status == status) for p in people]

	return {
		"data": {
			"labels": people,
			"datasets": [
				{"name": _("Visited"), "values": series("Visited")},
				{"name": _("Skipped"), "values": series("Skipped")},
				{"name": _("Missed"), "values": series("Missed")},
			],
		},
		"type": "bar",
		"barOptions": {"stacked": 1},
		"colors": ["#16a34a", "#f59e0b", "#dc2626"],
	}
