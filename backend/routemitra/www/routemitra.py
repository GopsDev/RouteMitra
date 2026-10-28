# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""
/routemitra: the sales rep's mobile page. Everything on it loads through api/v1/field.py.
Managers work in the Desk, so they are sent there. A rep (Sales User, not a manager)
who opens it on a laptop is asked to use the mobile app instead.
"""

import base64
import io
import os
import re

import frappe
from pyqrcode import create as make_qr

from routemitra.routemitra_core.doctype.routemitra_settings.routemitra_settings import get_settings
from routemitra.routemitra_core.field_access import is_manager

no_cache = 1

ASSETS = ("js/field_app.js", "css/field_app.css")
PHONE_AGENTS = re.compile(r"Mobi|Android|iPhone|iPad|iPod", re.IGNORECASE)


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/routemitra"
		raise frappe.Redirect
	if not frappe.has_permission("Sales Visit", "create"):
		frappe.throw(frappe._("You need the Sales User role to use RouteMitra."), frappe.PermissionError)
	# Managers plan routes and review visits in the Desk; this page is for field work.
	if is_manager():
		frappe.local.flags.redirect_location = "/desk"
		raise frappe.Redirect
	context.no_cache = 1
	context.version = _asset_version()

	# Reps do field work on their phone; on a laptop they get the app download instead.
	if not is_phone():
		app_url = get_settings().android_app_url
		context.get_app = True
		context.app_url = app_url
		context.app_qr = qr_image(app_url) if app_url else None
		# The address the rep opened this page at, which is what the app should connect to.
		context.site_url = frappe.request.host_url.rstrip("/")
		context.user_name = frappe.utils.get_fullname(frappe.session.user)
	return context


def is_phone():
	"""Whether the browser says it's a phone or tablet."""
	agent = frappe.get_request_header("User-Agent") or ""
	return bool(PHONE_AGENTS.search(agent))


def qr_image(text):
	"""A QR code for the text as an SVG data URL, for the rep to scan with their phone."""
	buffer = io.BytesIO()
	make_qr(text).svg(buffer, scale=5, module_color="#0f1d2e", background="#ffffff")
	return "data:image/svg+xml;base64," + base64.b64encode(buffer.getvalue()).decode()


def _asset_version():
	"""Changes whenever the page's JS or CSS changes, so phones never run a stale copy."""
	public = frappe.get_app_path("routemitra", "public")
	return str(int(max(os.path.getmtime(os.path.join(public, path)) for path in ASSETS)))
