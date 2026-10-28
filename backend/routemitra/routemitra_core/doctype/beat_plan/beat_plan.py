# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from routemitra.routemitra_core.notifications import notify_plan_assigned, notify_plan_updated

from .route import optimize_stops, refresh_stops


class BeatPlan(Document):
	def validate(self):
		self.validate_visited_stops()
		refresh_stops(self)

	def validate_visited_stops(self):
		"""A stop is Visited only through a real check-in at that customer on this plan."""
		for stop in self.stops:
			if stop.status != "Visited":
				continue
			visit = stop.sales_visit and frappe.db.get_value(
				"Sales Visit", stop.sales_visit, ["customer", "beat_plan"], as_dict=True
			)
			if not visit or visit.customer != stop.customer or visit.beat_plan != self.name:
				frappe.throw(
					_("Row {0}: {1} can only be marked Visited by checking in there.").format(stop.idx, stop.customer)
				)

	def on_update(self):
		before = self.get_doc_before_save()
		if not before or before.sales_person != self.sales_person or str(before.plan_date) != str(self.plan_date):
			notify_plan_assigned(self)
		else:
			# Same rep and day: tell them if shops were added or removed
			notify_plan_updated(self, before)

	def optimize_route(self):
		"""Reorder the planned stops to shorten the day's route, then save."""
		optimize_stops(self)
		self.save()
