# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""doc_events hooks for Address (owned by Frappe Contacts)."""

from .geocoding import handle_address_update


def on_update(doc, method):
	"""Queue a location lookup when the address text changes."""
	handle_address_update(doc)
