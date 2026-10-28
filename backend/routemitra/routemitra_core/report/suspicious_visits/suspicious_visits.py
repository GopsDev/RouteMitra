# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""Flagged Sales Visits for managers to review, with how often each sales person is flagged."""

import re

import frappe
from frappe import _
from frappe.utils import add_days, flt, getdate

# Short names for the reasons fraud.py writes, matched on its wording; shown as chips and in the chart.
REASONS = [
	("Too short", r"minutes at the shop"),
	("Outside radius", r"^Checked (in|out) \d+ m from the shop"),
	("Not located", r"no location on record"),
	("Fake GPS", r"mock \(fake GPS\)"),
	("Too-exact GPS", r"better than phones achieve"),
	("Fast travel", r"km/h"),
	("Copied GPS", r"Exactly the same coordinates"),
	("Same spot", r"same spot as"),
	("Pin moved", r"set the shop's location themselves"),
	("Gallery photo", r"picked from a file"),
	("Reused photo", r"same image as"),
	("No check-out", r"Never checked out"),
]


def execute(filters=None):
	filters = frappe._dict(filters or {})
	visits = _visits(filters)
	return _columns(), visits, None, _chart(visits, filters), _summary(visits, filters)


def _columns():
	return [
		{"fieldname": "photo", "label": _("Photo"), "fieldtype": "Data", "width": 70},
		{"fieldname": "name", "label": _("Visit"), "fieldtype": "Link", "options": "Sales Visit", "width": 145},
		{"fieldname": "customer_name", "label": _("Customer"), "fieldtype": "Data", "width": 175},
		{"fieldname": "sales_person", "label": _("Sales Person"), "fieldtype": "Link", "options": "Sales Person", "width": 165},
		{"fieldname": "checkin_time", "label": _("Check-in"), "fieldtype": "Datetime", "width": 155},
		{"fieldname": "status", "label": _("GPS Status"), "fieldtype": "Data", "width": 125},
		{"fieldname": "distance_m", "label": _("Distance"), "fieldtype": "Int", "width": 90},
		{"fieldname": "duration_minutes", "label": _("Time at Shop"), "fieldtype": "Int", "width": 105},
		{"fieldname": "reasons", "label": _("Why Flagged"), "fieldtype": "Data", "width": 300},
		{"fieldname": "review_status", "label": _("Review"), "fieldtype": "Data", "width": 130},
		{"fieldname": "reviewed_by", "label": _("Reviewed By"), "fieldtype": "Link", "options": "User", "width": 140},
	]


def _visits(filters):
	conditions = {
		"is_suspicious": 1,
		"checkin_time": ["between", [getdate(filters.from_date), add_days(getdate(filters.to_date), 1)]],
	}
	if filters.sales_person:
		conditions["sales_person"] = filters.sales_person
	if filters.review_status:
		conditions["review_status"] = filters.review_status
	rows = frappe.get_list(
		"Sales Visit",
		filters=conditions,
		fields=[
			"name", "checkin_time", "sales_person", "customer_name", "status", "distance_m",
			"duration_minutes", "fraud_flags", "review_status", "reviewed_by", "photo",
		],
		order_by="checkin_time desc",
	)
	for row in rows:
		lines = [line for line in (row.fraud_flags or "").splitlines() if line]
		# Short names for the chips; the full sentences go in the tooltip.
		row.reasons = ", ".join(reason_name(line) for line in lines)
		row.fraud_flags = "\n".join(lines)
	return rows


def reason_name(line):
	"""The short name of one fraud flag sentence, or the sentence itself if it is a new kind."""
	for name, pattern in REASONS:
		if re.search(pattern, line):
			return name
	return line


def _totals_by_person(filters):
	"""{sales person: [all visits, flagged visits]} in the date range."""
	conditions = {"checkin_time": ["between", [getdate(filters.from_date), add_days(getdate(filters.to_date), 1)]]}
	if filters.sales_person:
		conditions["sales_person"] = filters.sales_person
	totals = {}
	for row in frappe.get_list("Sales Visit", filters=conditions, fields=["sales_person", "is_suspicious"]):
		entry = totals.setdefault(row.sales_person or _("Not Set"), [0, 0])
		entry[0] += 1
		entry[1] += row.is_suspicious
	return totals


def _chart(visits, filters):
	"""Why visits were flagged: how many flagged visits had each reason."""
	counts = {}
	for visit in visits:
		for name in set(visit.reasons.split(", ")) if visit.reasons else []:
			counts[name] = counts.get(name, 0) + 1
	if not counts:
		return None
	names = sorted(counts, key=lambda n: -counts[n])
	return {
		"data": {"labels": names, "datasets": [{"name": _("Flagged Visits"), "values": [counts[n] for n in names]}]},
		"type": "donut",
		"height": 220,
		"colors": ["#e5484d", "#f59e0b", "#0e7c80", "#7c3aed", "#2563eb", "#db2777", "#65a30d", "#0891b2", "#a16207", "#475569", "#9333ea", "#be123c"],
	}


def _summary(visits, filters):
	totals = _totals_by_person(filters)
	all_visits = sum(t[0] for t in totals.values())
	flagged = sum(t[1] for t in totals.values())
	# The table may be filtered to one review status, so count the statuses over every flagged visit.
	statuses = _review_counts(filters)
	pending = statuses.get("Pending Review", 0)
	approved = statuses.get("Approved", 0)
	rejected = statuses.get("Rejected", 0)
	flagged_pct = flt(flagged * 100 / all_visits, 1) if all_visits else 0
	return [
		{"label": _("Total Visits"), "value": all_visits, "datatype": "Int", "indicator": "Blue"},
		{"label": _("Flagged"), "value": flagged, "datatype": "Int", "indicator": "Red" if flagged else "Green"},
		{"label": _("Flagged %"), "value": flagged_pct, "datatype": "Percent", "indicator": "Red" if flagged_pct > 20 else "Green"},
		{"label": _("Pending Review"), "value": pending, "datatype": "Int", "indicator": "Orange" if pending else "Green"},
		{"label": _("Approved"), "value": approved, "datatype": "Int", "indicator": "Green"},
		{"label": _("Rejected"), "value": rejected, "datatype": "Int", "indicator": "Red" if rejected else "Green"},
	]


def _review_counts(filters):
	"""{review status: flagged visits} in the date range, ignoring the Review Status filter."""
	conditions = {
		"is_suspicious": 1,
		"checkin_time": ["between", [getdate(filters.from_date), add_days(getdate(filters.to_date), 1)]],
	}
	if filters.sales_person:
		conditions["sales_person"] = filters.sales_person
	counts = {}
	for row in frappe.get_list("Sales Visit", filters=conditions, fields=["review_status"]):
		counts[row.review_status] = counts.get(row.review_status, 0) + 1
	return counts
