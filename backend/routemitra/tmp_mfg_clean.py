import frappe

COMPANY = "Velan Furniture Works (Demo)"


def drop(doctype, filters, order="creation desc"):
	for name in frappe.get_all(doctype, filters=filters, pluck="name", order_by=order):
		doc = frappe.get_doc(doctype, name)
		if doc.docstatus == 1:
			doc.flags.ignore_links = True
			doc.cancel()
		frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)


def run():
	"""Remove every test transaction of the demo company (masters stay)."""
	frappe.set_user("Administrator")
	drop("Stock Entry", {"company": COMPANY, "stock_entry_type": "Manufacture"})
	drop("Job Card", {"company": COMPANY})
	drop("Stock Entry", {"company": COMPANY})
	drop("Work Order", {"company": COMPANY})
	drop("Material Request", {"company": COMPANY})
	drop("Production Plan", {"company": COMPANY})
	drop("Sales Order", {"company": COMPANY})
	drop("BOM", {"company": COMPANY})
	frappe.db.commit()
	for dt in ("Job Card", "Stock Entry", "Work Order", "Production Plan", "Sales Order", "BOM"):
		print(dt, frappe.db.count(dt, {"company": COMPANY}))
