# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""Install/migrate-time setup: location fields on Address, saved settings defaults."""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

# Named latitude/longitude so Frappe's built-in Map view also works on the Address list.
ADDRESS_FIELDS = [
	{"fieldname": "rm_location_section", "fieldtype": "Section Break", "label": "Map Location", "insert_after": "is_your_company_address", "collapsible": 1},
	{"fieldname": "latitude", "fieldtype": "Float", "label": "Latitude", "precision": "6", "insert_after": "rm_location_section"},
	{"fieldname": "longitude", "fieldtype": "Float", "label": "Longitude", "precision": "6", "insert_after": "latitude"},
	{"fieldname": "rm_location_column", "fieldtype": "Column Break", "insert_after": "longitude"},
	{
		"fieldname": "geocode_status",
		"fieldtype": "Select",
		"label": "Location Status",
		"options": "\nLocated\nApproximate\nNot Found\nManual\nGPS",
		"read_only": 1,
		"in_standard_filter": 1,
		"insert_after": "rm_location_column",
		"description": "Approximate means only the area or PIN code could be found. Use Set Location from GPS while at the shop (GPS), or type Latitude and Longitude (Manual). Neither is ever overwritten.",
	},
	{"fieldname": "geocoded_on", "fieldtype": "Datetime", "label": "Located On", "read_only": 1, "insert_after": "geocode_status"},
	{"fieldname": "location_set_by", "fieldtype": "Link", "options": "User", "label": "Location Set By", "read_only": 1, "insert_after": "geocoded_on", "depends_on": "location_set_by"},
]


def after_install():
	"""Add the location fields to Address and store the settings defaults."""
	add_address_fields()
	save_default_settings()


def after_migrate():
	"""Keep the location fields in place after upgrades."""
	add_address_fields()


def add_address_fields():
	"""Create or update the custom fields (idempotent)."""
	create_custom_fields({"Address": ADDRESS_FIELDS}, update=True)


def save_default_settings():
	"""
	A Single's field defaults only exist once it is saved; save them so
	auto-geocoding is on from the start.
	"""
	settings = frappe.get_single("RouteMitra Settings")
	for field in settings.meta.fields:
		if field.default and settings.get(field.fieldname) in (None, ""):
			settings.set(field.fieldname, field.default)
	settings.flags.ignore_permissions = True
	settings.save()
