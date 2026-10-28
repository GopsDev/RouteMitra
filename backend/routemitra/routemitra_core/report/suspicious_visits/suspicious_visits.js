// Copyright (c) 2026, Gopal and contributors
// For license information, please see license.txt

const GPS_COLORS = { Verified: "green", "Outside Radius": "orange", "Customer Not Located": "gray" };
const REVIEW_PILLS = { "Pending Review": "orange", Approved: "green", Rejected: "red" };

frappe.query_reports["Suspicious Visits"] = {
	filters: [
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date", reqd: 1, default: frappe.datetime.add_days(frappe.datetime.get_today(), -30) },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date", reqd: 1, default: frappe.datetime.get_today() },
		{ fieldname: "sales_person", label: __("Sales Person"), fieldtype: "Link", options: "Sales Person" },
		{ fieldname: "review_status", label: __("Review Status"), fieldtype: "Select", options: "\nPending Review\nApproved\nRejected", default: "Pending Review" },
	],
	formatter(value, row, column, data, default_formatter) {
		if (!data) return default_formatter(value, row, column, data);
		const esc = frappe.utils.escape_html;
		const pill = (text, color) => `<span class="indicator-pill ${color}">${esc(text)}</span>`;

		switch (column.fieldname) {
			case "photo":
				// The shop photo taken at check-in, so the manager sees the shop without opening the visit.
				return data.photo
					? `<img src="${esc(data.photo)}" alt="" style="width:46px;height:28px;object-fit:cover;border-radius:6px;vertical-align:middle;border:1px solid var(--border-color)">`
					: `<span class="text-muted">—</span>`;
			case "customer_name":
				return `<b>${esc(data.customer_name || "")}</b>`;
			case "status":
				return data.status ? pill(__(data.status), GPS_COLORS[data.status] || "gray") : "";
			case "distance_m": {
				if (data.distance_m == null) return `<span class="text-muted">—</span>`;
				const far = data.status === "Outside Radius";
				return `<span style="${far ? "color:var(--red-600);font-weight:600" : ""}">${data.distance_m} m</span>`;
			}
			case "duration_minutes": {
				if (data.duration_minutes == null) return `<span class="text-muted">${__("open")}</span>`;
				const short = (data.reasons || "").split(", ").includes("Too short");
				return `<span style="${short ? "color:var(--red-600);font-weight:600" : ""}">${data.duration_minutes} min</span>`;
			}
			case "reasons": {
				// One chip per reason; hovering shows the full sentences.
				const chips = (data.reasons || "").split(", ").filter(Boolean).map((r) => pill(__(r), "red")).join(" ");
				return `<span title="${esc(data.fraud_flags || "")}">${chips}</span>`;
			}
			case "review_status":
				return data.review_status ? pill(__(data.review_status), REVIEW_PILLS[data.review_status] || "gray") : "";
		}
		return default_formatter(value, row, column, data);
	},
};
