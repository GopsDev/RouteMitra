// Copyright (c) 2026, Gopal and contributors
// For license information, please see license.txt

frappe.listview_settings["Sales Visit"] = {
	add_fields: ["status", "is_suspicious", "review_status"],
	get_indicator(doc) {
		if (doc.is_suspicious && doc.review_status === "Pending Review") return [__("Suspicious"), "red", "review_status,=,Pending Review"];
		if (doc.is_suspicious && doc.review_status === "Rejected") return [__("Rejected"), "red", "review_status,=,Rejected"];
		const colors = { Verified: "green", "Outside Radius": "orange", "Customer Not Located": "gray" };
		return [__(doc.status), colors[doc.status] || "gray", `status,=,${doc.status}`];
	},
};
