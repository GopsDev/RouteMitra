// Copyright (c) 2026, Gopal and contributors
// For license information, please see license.txt

// Field reps work only in the mobile page (/routemitra): check-in, check-out and nearby shops all happen there.
// Send them there if they open the Desk.
if (frappe.boot && frappe.boot.rm_field_only) window.location.replace("/routemitra");
