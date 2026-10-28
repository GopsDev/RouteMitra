# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""Stop coordinates, distances and visiting order for a Beat Plan."""

import frappe
from frappe.utils import flt

from routemitra.routemitra_core.customer_locations import get_customer_point
from routemitra.utils.geo import distance_m, order_stops


def refresh_stops(doc):
	"""Fill each stop's coordinates and the distance totals."""
	seen = set()
	for stop in doc.stops:
		if stop.customer in seen:
			frappe.throw(f"Row {stop.idx}: {stop.customer} is already on this plan.")
		seen.add(stop.customer)
		point = get_customer_point(stop.customer)
		stop.latitude, stop.longitude = (point[0], point[1]) if point else (0, 0)

	previous, total = _start(doc), 0.0
	for stop in doc.stops:
		if _located(stop):
			stop.distance_km = round(distance_m(*previous, stop.latitude, stop.longitude) / 1000, 2) if previous else 0
			total += stop.distance_km
			previous = (stop.latitude, stop.longitude)
		else:
			stop.distance_km = 0

	doc.total_stops = len(doc.stops)
	doc.visited_stops = sum(1 for s in doc.stops if s.status == "Visited")
	doc.total_distance_km = round(total, 2)


def optimize_stops(doc):
	"""
	Reorder stops: visited/skipped ones stay first in their current order,
	planned located ones are ordered by shortest route, unlocated ones go last.
	"""
	refresh_stops(doc)
	done = [s for s in doc.stops if s.status != "Planned"]
	planned = [s for s in doc.stops if s.status == "Planned" and _located(s)]
	unlocated = [s for s in doc.stops if s.status == "Planned" and not _located(s)]

	start = (done[-1].latitude, done[-1].longitude) if done and _located(done[-1]) else _start(doc)
	order = order_stops([(s.latitude, s.longitude) for s in planned], start)
	doc.stops = done + [planned[i] for i in order] + unlocated
	for idx, stop in enumerate(doc.stops, start=1):
		stop.idx = idx
	refresh_stops(doc)


def _start(doc):
	if flt(doc.start_latitude) and flt(doc.start_longitude):
		return (flt(doc.start_latitude), flt(doc.start_longitude))
	return None


def _located(stop):
	return bool(flt(stop.latitude) and flt(stop.longitude))
