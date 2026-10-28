import frappe
from frappe.utils.password import update_password

COMPANY = "Velan Furniture Works (Demo)"
ABBR = "VFW"


def run(password):
	frappe.set_user("Administrator")
	if not frappe.db.exists("Company", COMPANY):
		frappe.get_doc({"doctype": "Company", "company_name": COMPANY, "abbr": ABBR, "default_currency": "INR",
			"country": "India", "chart_of_accounts": "Standard"}).insert()
	stores, fg = f"Stores - {ABBR}", f"Finished Goods - {ABBR}"

	items = [
		("VF-CHAIR", "Wooden Chair", "Products", fg, 0, 0),
		("VF-TEAK", "Teak Wood Plank", "Raw Material", stores, 650, 1),
		("VF-SCREW", "Wood Screw (Box of 50)", "Raw Material", stores, 120, 1),
		("VF-GLUE", "Wood Glue 500 ml", "Raw Material", stores, 180, 1),
		("VF-VARNISH", "Varnish 1 L", "Raw Material", stores, 420, 1),
		("VF-CUSHION", "Seat Cushion", "Raw Material", stores, 350, 1),
	]
	for code, name, group, wh, rate, purchase in items:
		if frappe.db.exists("Item", code):
			continue
		frappe.get_doc({"doctype": "Item", "item_code": code, "item_name": name, "item_group": group, "stock_uom": "Nos",
			"is_stock_item": 1, "include_item_in_manufacturing": 1, "valuation_rate": rate, "is_purchase_item": purchase,
			"is_sales_item": 0 if purchase else 1, "standard_rate": 0 if purchase else 4500,
			"item_defaults": [{"company": COMPANY, "default_warehouse": wh}]}).insert()

	for ws, rate in (("VF Cutting Station", 300), ("VF Assembly Bench", 250), ("VF Polishing Booth", 200)):
		if not frappe.db.exists("Workstation", ws):
			frappe.get_doc({"doctype": "Workstation", "workstation_name": ws, "hour_rate_labour": rate, "hour_rate_electricity": 50,
				"production_capacity": 1}).insert()
	for op, ws in (("Wood Cutting", "VF Cutting Station"), ("Chair Assembly", "VF Assembly Bench"), ("Polishing", "VF Polishing Booth")):
		if not frappe.db.exists("Operation", op):
			frappe.get_doc({"doctype": "Operation", "name": op, "__newname": op, "workstation": ws}).insert()

	if not frappe.db.exists("Customer", "Anbu Interiors (Demo)"):
		frappe.get_doc({"doctype": "Customer", "customer_name": "Anbu Interiors (Demo)", "customer_group": "Commercial",
			"territory": "India", "customer_type": "Company"}).insert()

	email = "mfg.demo@example.com"
	if not frappe.db.exists("User", email):
		user = frappe.get_doc({"doctype": "User", "email": email, "first_name": "Velan", "last_name": "Demo",
			"send_welcome_email": 0, "user_type": "System User"})
		user.flags.no_welcome_mail = True
		user.insert()
		user.add_roles("Manufacturing Manager", "Manufacturing User", "Stock Manager", "Stock User", "Item Manager",
			"Sales Manager", "Sales User", "Purchase Manager", "Purchase User", "Accounts User", "Quality Manager")
	update_password(email, password)
	if not frappe.db.exists("User Permission", {"user": email, "allow": "Company", "for_value": COMPANY}):
		frappe.get_doc({"doctype": "User Permission", "user": email, "allow": "Company", "for_value": COMPANY,
			"apply_to_all_doctypes": 1, "is_default": 1}).insert()
	frappe.db.commit()
	print("company:", frappe.db.exists("Company", COMPANY), "| warehouses:", frappe.get_all("Warehouse", filters={"company": COMPANY, "is_group": 0}, pluck="name"))
	print("items:", frappe.get_all("Item", filters={"item_code": ["like", "VF-%"]}, pluck="name"))
	print("operations:", frappe.get_all("Operation", filters={"name": ["in", ["Wood Cutting", "Chair Assembly", "Polishing"]]}, pluck="name"))
