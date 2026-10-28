# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from .checkin import mark_beat_plan_stop

# Set only by check-in, check-out and review (checkin.py). Read-only in the form is not
# enough: the REST API accepts any field, so the controller puts these back on every save.
PROTECTED_FIELDS = (
	"customer", "sales_person", "beat_plan", "status", "distance_m",
	"checkin_time", "checkin_latitude", "checkin_longitude", "checkin_accuracy_m",
	"customer_latitude", "customer_longitude",
	"checkout_time", "checkout_latitude", "checkout_longitude", "checkout_accuracy_m",
	"checkout_distance_m", "duration_minutes",
	"photo", "photo_hash", "is_suspicious", "fraud_flags",
	"review_status", "reviewed_by", "review_notes",
)


class SalesVisit(Document):
	def before_insert(self):
		if not self.flags.from_checkin:
			frappe.throw(
				_("Sales Visits are created by checking in from the RouteMitra mobile page (/routemitra)."),
				frappe.PermissionError,
			)

	def validate(self):
		if self.is_new() or self.flags.from_checkin:
			return
		before = self.get_doc_before_save()
		if before:
			for field in PROTECTED_FIELDS:
				self.set(field, before.get(field))

	def after_insert(self):
		mark_beat_plan_stop(self)
