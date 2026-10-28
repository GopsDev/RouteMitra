import frappe
from frappe.model.base_document import get_controller

def run():
    try:
        from frappe.model.sync import clear_controller_cache as ccc
        ccc()
    except Exception:
        pass
    overrides = frappe.get_hooks("override_doctype_class", {})
    orphans = []
    for dt in frappe.get_all("DocType", {"custom": 0}, pluck="name"):
        if dt in overrides:
            continue
        try:
            get_controller(doctype=dt)
        except (ImportError, frappe.DoesNotExistError):
            orphans.append((dt, frappe.db.get_value("DocType", dt, "module")))
        except Exception:
            pass
    print("ORPHANS", orphans)
