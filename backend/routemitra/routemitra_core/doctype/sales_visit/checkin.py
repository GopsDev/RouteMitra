# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""GPS check-in and check-out: record where the rep really was, for how long, and anything suspicious."""

import base64
import hashlib
import io

import frappe
from PIL import Image
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime, time_diff_in_seconds

from routemitra.routemitra_core.customer_locations import get_customer_point
from routemitra.routemitra_core.doctype.routemitra_settings.routemitra_settings import get_settings
from routemitra.routemitra_core.doctype.sales_visit import fraud
from routemitra.routemitra_core.notifications import notify_visit_reviewed
from routemitra.utils.geo import distance_m

MAX_ACCURACY_M = 1000  # worse than this is a Wi-Fi/IP guess, not GPS
MAX_PHOTO_BYTES = 8 * 1024 * 1024
PHOTO_TYPES = {b"\xff\xd8\xff": "jpg", b"\x89PNG": "png", b"RIFF": "webp"}
MANAGER_ROLES = ("Sales Manager", "System Manager")


def check_in(customer, latitude, longitude, accuracy_m, beat_plan=None, photo=None, photo_source=None, is_mocked=None):
	"""
	Create a Sales Visit from the device's GPS position.

	Status is Verified when the rep is within the check-in radius (plus the
	GPS accuracy, capped at 100 m). Anything that looks faked is flagged for review.

	Parameters:
	        customer (str, required): Customer being visited.
	        latitude, longitude (float, required): Device position.
	        accuracy_m (float, required): GPS accuracy reported by the browser.
	        beat_plan (str, optional): Beat Plan to tick off; must be the rep's own.
	        photo (str, optional): Shop photo as a data URL; required when the settings say so.
	        photo_source (str, optional): "camera" for the live in-page camera; a file-picker photo is flagged.
	        is_mocked (bool, optional): The phone said the position came from a mock-location app.

	Returns:
	        Document: The new Sales Visit.
	"""
	settings = get_settings()
	accuracy = _require_gps(latitude, longitude, accuracy_m)
	_ensure_no_open_visit()
	photo_bytes, photo_ext = _decode_photo(photo)
	if settings.require_photo and not photo_bytes:
		frappe.throw(_("Take a photo of the shop to check in."), title=_("Photo Required"))

	point = get_customer_point(customer)
	lat, lng = flt(latitude), flt(longitude)
	# Checked in from Nearby at a shop that's on today's route: still tick the route's stop.
	beat_plan = beat_plan or _todays_plan_with(customer)

	visit = frappe.new_doc("Sales Visit")
	visit.flags.from_checkin = True
	visit.flags.photo_source = photo_source
	visit.flags.is_mocked = cint(is_mocked)
	visit.update({
		"customer": customer,
		"beat_plan": beat_plan,
		"sales_person": _sales_person(beat_plan, customer),
		"checkin_time": now_datetime(),
		"checkin_latitude": lat,
		"checkin_longitude": lng,
		"checkin_accuracy_m": cint(accuracy),
		"photo_hash": hashlib.sha256(photo_bytes).hexdigest() if photo_bytes else None,
	})

	if point:
		visit.customer_latitude, visit.customer_longitude = point[0], point[1]
		visit.distance_m = int(round(distance_m(lat, lng, point[0], point[1])))
		visit.status = "Verified" if visit.distance_m <= fraud.allowance_m(settings, accuracy) else "Outside Radius"
	else:
		visit.status = "Customer Not Located"

	fraud.add_flags(visit, fraud.checkin_flags(visit, accuracy, settings))
	visit.insert()
	if photo_bytes:
		_attach_photo(visit, photo_bytes, photo_ext)
	return visit


def check_out(visit_name, latitude, longitude, accuracy_m, is_mocked=None):
	"""
	Record where and when the rep left the shop.

	Parameters:
	        visit_name (str, required): The rep's own open Sales Visit.
	        latitude, longitude (float, required): Device position.
	        accuracy_m (float, required): GPS accuracy reported by the browser.
	        is_mocked (bool, optional): The phone said the position came from a mock-location app.

	Returns:
	        Document: The updated Sales Visit.
	"""
	settings = get_settings()
	accuracy = _require_gps(latitude, longitude, accuracy_m)
	visit = frappe.get_doc("Sales Visit", visit_name)
	if visit.owner != frappe.session.user:
		frappe.throw(_("Only the sales person who checked in can check out."), frappe.PermissionError)
	if visit.checkout_time:
		frappe.throw(_("{0} is already checked out.").format(visit.name))

	lat, lng = flt(latitude), flt(longitude)
	visit.flags.from_checkin = True
	visit.flags.is_mocked = cint(is_mocked)
	visit.checkout_time = now_datetime()
	visit.checkout_latitude, visit.checkout_longitude = lat, lng
	visit.checkout_accuracy_m = cint(accuracy)
	visit.duration_minutes = int(time_diff_in_seconds(visit.checkout_time, visit.checkin_time) // 60)
	if visit.customer_latitude and visit.customer_longitude:
		visit.checkout_distance_m = int(round(distance_m(lat, lng, visit.customer_latitude, visit.customer_longitude)))

	fraud.add_flags(visit, fraud.checkout_flags(visit, accuracy, settings))
	visit.save()
	return visit


def review(visit_name, decision, notes=None):
	"""
	A manager approves or rejects a flagged visit.

	Parameters:
	        visit_name (str, required): Sales Visit.
	        decision (str, required): "Approved" or "Rejected".
	        notes (str, optional): Why.

	Returns:
	        Document: The updated Sales Visit.
	"""
	if not set(MANAGER_ROLES) & set(frappe.get_roles()):
		frappe.throw(_("Only a Sales Manager can review visits."), frappe.PermissionError)
	if decision not in ("Approved", "Rejected"):
		frappe.throw(_("Decision must be Approved or Rejected."))
	visit = frappe.get_doc("Sales Visit", visit_name)
	if visit.owner == frappe.session.user:
		frappe.throw(_("You can't review your own visit."), frappe.PermissionError)
	visit.flags.from_checkin = True
	visit.update({"review_status": decision, "reviewed_by": frappe.session.user, "review_notes": notes})
	visit.save()
	notify_visit_reviewed(visit)
	return visit


def mark_beat_plan_stop(visit):
	"""Tick the customer's stop on the linked Beat Plan as Visited."""
	if not visit.beat_plan:
		return
	plan = frappe.get_doc("Beat Plan", visit.beat_plan)
	for stop in plan.stops:
		if stop.customer == visit.customer:
			stop.status = "Visited"
			stop.sales_visit = visit.name
			plan.save(ignore_permissions=True)
			return


def _require_gps(latitude, longitude, accuracy_m):
	"""Reject positions that can't have come from a GPS fix; return the accuracy as a float."""
	if not (flt(latitude) and flt(longitude)):
		frappe.throw(_("No position received from the device."))
	if accuracy_m in (None, ""):
		frappe.throw(_("The device didn't report how accurate its position is."))
	accuracy = flt(accuracy_m)
	if accuracy > MAX_ACCURACY_M:
		frappe.throw(
			_("Your position is only accurate to ±{0} km, which isn't GPS. Check in from a phone with location turned on.").format(
				round(accuracy / 1000, 1)
			),
			title=_("No GPS Position"),
		)
	return accuracy


def _ensure_no_open_visit():
	"""One visit at a time: the rep must check out of today's open visit first."""
	open_visit = frappe.db.get_value(
		"Sales Visit",
		{"owner": frappe.session.user, "checkout_time": ["is", "not set"], "checkin_time": [">=", getdate()]},
		["name", "customer_name"],
		as_dict=True,
	)
	if open_visit:
		frappe.throw(
			_("Check out of {0} ({1}) before checking in somewhere else.").format(
				f'<a href="/app/sales-visit/{open_visit.name}">{open_visit.name}</a>', frappe.bold(open_visit.customer_name)
			),
			title=_("Visit Still Open"),
		)


def _decode_photo(photo):
	"""(bytes, extension) from a data URL, or (None, None). Only real images under the size limit."""
	if not photo:
		return None, None
	try:
		data = base64.b64decode(photo.split(",", 1)[-1], validate=True)
	except Exception:
		frappe.throw(_("The shop photo couldn't be read. Take it again."))
	if len(data) > MAX_PHOTO_BYTES:
		frappe.throw(_("The shop photo is too large."))
	ext = next((ext for magic, ext in PHOTO_TYPES.items() if data.startswith(magic)), None)
	try:
		Image.open(io.BytesIO(data)).verify()
	except Exception:
		ext = None
	if not ext:
		frappe.throw(_("The shop photo must be a JPEG, PNG or WebP image."))
	return data, ext


def _attach_photo(visit, data, ext):
	file = frappe.get_doc({
		"doctype": "File",
		"file_name": f"{visit.name}-shop.{ext}",
		"content": data,
		"attached_to_doctype": "Sales Visit",
		"attached_to_name": visit.name,
		"attached_to_field": "photo",
		"is_private": 1,
	})
	file.save(ignore_permissions=True)
	visit.db_set("photo", file.file_url, update_modified=False)


def _todays_plan_with(customer):
	"""The rep's Beat Plan for today where this customer is still a Planned stop, or None."""
	own = own_sales_person()
	if not own:
		return None
	plan = frappe.db.sql(
		"""
		select bp.name from `tabBeat Plan` bp
		join `tabBeat Plan Stop` s on s.parent = bp.name and s.parenttype = 'Beat Plan'
		where bp.sales_person = %s and bp.plan_date = %s and s.customer = %s and s.status = 'Planned'
		order by bp.creation
		limit 1
		""",
		(own, getdate(), customer),
	)
	return plan[0][0] if plan else None


def _sales_person(beat_plan, customer):
	"""
	Whose visit this is. On a Beat Plan it must be the rep's own plan and the
	customer must be on it; managers without a Sales Person record may check in on any plan.
	"""
	own = own_sales_person()
	if not beat_plan:
		return own
	plan = frappe.get_doc("Beat Plan", beat_plan)
	plan.check_permission("read")
	if plan.sales_person != own and not (own is None and set(MANAGER_ROLES) & set(frappe.get_roles())):
		frappe.throw(_("{0} belongs to another sales person.").format(beat_plan), frappe.PermissionError)
	if customer not in {stop.customer for stop in plan.stops}:
		frappe.throw(_("{0} isn't on {1}.").format(customer, beat_plan))
	return plan.sales_person


def own_sales_person():
	"""The Sales Person linked (through Employee) to the logged-in user, or None."""
	employee = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")
	return frappe.db.get_value("Sales Person", {"employee": employee}, "name") if employee else None
