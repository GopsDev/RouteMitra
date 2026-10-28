# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""Login for the RouteMitra mobile app. The app then calls field.py and maps.py with a token header."""

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.twofactor import should_run_2fa


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=10 * 60)
def login(usr: str, pwd: str):
	"""
	Check the rep's ERPNext password and return an API token for the mobile app.

	Each login makes a new secret, so the rep's older phone (if any) is logged out.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.auth.login
	HTTP Method: POST
	Parameters:
	        - usr (str, required): Email or username.
	        - pwd (str, required): Password.
	Response: {"message": {"token": "<api_key>:<api_secret>", "user": "...", "full_name": "..."}}
	The app sends the token on every request as the header "Authorization: token <api_key>:<api_secret>".
	"""
	# Same checks as the login page: wrong password, disabled user, too many attempts.
	frappe.local.login_manager.authenticate(user=usr, pwd=pwd)
	user = frappe.local.login_manager.user
	if should_run_2fa(user):
		frappe.throw(_("Two-factor login isn't supported in the app yet. Use the web page."), frappe.AuthenticationError)

	frappe.set_user(user)
	if not frappe.has_permission("Sales Visit", "create"):
		frappe.throw(_("You need the Sales User role to use RouteMitra."), frappe.PermissionError)

	doc = frappe.get_doc("User", user)
	if not doc.api_key:
		doc.api_key = frappe.generate_hash(length=15)
	secret = frappe.generate_hash(length=15)
	doc.api_secret = secret
	doc.save(ignore_permissions=True)
	return {"token": f"{doc.api_key}:{secret}", "user": user, "full_name": doc.full_name}


@frappe.whitelist(methods=["POST"])
def logout():
	"""
	Throw away the app's token by changing the secret, so a lost phone can't be used.

	Endpoint: /api/method/routemitra.routemitra_core.api.v1.auth.logout
	HTTP Method: POST
	Response: {"message": {"ok": true}}
	"""
	doc = frappe.get_doc("User", frappe.session.user)
	doc.api_secret = frappe.generate_hash(length=15)
	doc.save(ignore_permissions=True)
	return {"ok": True}
