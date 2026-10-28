// Copyright (c) 2026, Gopal and contributors
// For license information, please see license.txt

const VISIT_COLORS = { Verified: "green", "Outside Radius": "orange", "Customer Not Located": "gray" };
const REVIEW_COLORS = { "Pending Review": "red", Approved: "green", Rejected: "red" };

frappe.ui.form.on("Sales Visit", {
	refresh(frm) {
		set_indicator(frm);
		show_flags(frm);
		if (frm.is_new()) return;
		if (frm.doc.is_suspicious && frm.doc.owner !== frappe.session.user && frappe.user.has_role(["Sales Manager", "System Manager"])) {
			frm.add_custom_button(__("Approve"), () => review(frm, "Approved"), __("Review"));
			frm.add_custom_button(__("Reject"), () => review(frm, "Rejected"), __("Review"));
		}
		if (!frm.doc.sales_order && frm.doc.customer) {
			frm.add_custom_button(__("Create Sales Order"), () => frappe.new_doc("Sales Order", { customer: frm.doc.customer }));
		}
		render_visit_map(frm);
	},
});

function set_indicator(frm) {
	const d = frm.doc;
	if (d.is_suspicious && d.review_status) frm.page.set_indicator(__(d.review_status === "Pending Review" ? "Suspicious" : d.review_status), REVIEW_COLORS[d.review_status]);
	else if (d.status) frm.page.set_indicator(__(d.status), VISIT_COLORS[d.status] || "gray");
}

function show_flags(frm) {
	const d = frm.doc;
	if (!d.is_suspicious || !d.fraud_flags) return frm.set_intro("");
	const reasons = d.fraud_flags.split("\n").filter(Boolean).map((r) => `<li>${frappe.utils.escape_html(r)}</li>`).join("");
	const status = d.review_status && d.review_status !== "Pending Review"
		? `<div style="margin-top:6px">${__("{0} by {1}", [__(d.review_status), frappe.utils.escape_html(d.reviewed_by || "")])}</div>`
		: "";
	frm.set_intro(`<b>${__("Flagged for review")}</b><ul style="margin:4px 0 0;padding-left:18px">${reasons}</ul>${status}`, d.review_status === "Approved" ? "green" : "red");
}

function review(frm, decision) {
	frappe.prompt(
		{ fieldname: "notes", fieldtype: "Small Text", label: __("Notes"), reqd: decision === "Rejected" },
		({ notes }) =>
			frappe
				.call({ method: "routemitra.routemitra_core.api.v1.maps.review_visit", args: { sales_visit: frm.doc.name, decision, notes }, freeze: true })
				.then(() => frm.reload_doc()),
		decision === "Approved" ? __("Approve Visit") : __("Reject Visit"),
		decision === "Approved" ? __("Approve") : __("Reject")
	);
}

function render_visit_map(frm) {
	const $wrapper = frm.get_field("visit_map").$wrapper;
	const d = frm.doc;
	if (!d.checkin_latitude || !d.checkin_longitude) return $wrapper.empty();

	$wrapper.html('<div class="rm-visit" style="height:300px;border-radius:10px;border:1px solid var(--border-color);z-index:0"></div>');
	if (frm.visit_map) frm.visit_map.remove();
	const map = (frm.visit_map = L.map($wrapper.find(".rm-visit")[0]));
	L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);

	const checkin = [d.checkin_latitude, d.checkin_longitude];
	const group = L.featureGroup().addTo(map);
	L.circleMarker(checkin, { radius: 8, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }).bindTooltip(__("Checked in here")).addTo(group);
	if (d.customer_latitude && d.customer_longitude) {
		const customer = [d.customer_latitude, d.customer_longitude];
		frappe.db.get_single_value("RouteMitra Settings", "checkin_radius").then((radius) => {
			L.circle(customer, { radius: radius || 150, color: "#16a34a", weight: 1, fillOpacity: 0.1 }).addTo(map);
		});
		L.circleMarker(customer, { radius: 8, color: "#fff", weight: 2, fillColor: "#16a34a", fillOpacity: 1 }).bindTooltip(frappe.utils.escape_html(d.customer_name || d.customer)).addTo(group);
		L.polyline([checkin, customer], { color: "#6b7280", dashArray: "4 4" }).addTo(group);
	}
	map.fitBounds(group.getBounds().pad(0.6), { maxZoom: 17 });
	setTimeout(() => map.invalidateSize(), 200);
}
