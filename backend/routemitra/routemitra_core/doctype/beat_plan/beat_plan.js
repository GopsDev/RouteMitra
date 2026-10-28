// Copyright (c) 2026, Gopal and contributors
// For license information, please see license.txt

const BEAT_API = "routemitra.routemitra_core.api.v1.maps";
const STOP_COLORS = { Planned: "#2563eb", Visited: "#16a34a", Skipped: "#9ca3af", Missed: "#dc2626" };

frappe.ui.form.on("Beat Plan", {
	refresh(frm) {
		render_route(frm);
		if (frm.is_new()) return;
		frm.add_custom_button(__("Optimize Route"), () =>
			frappe
				.call({ method: `${BEAT_API}.optimize_beat_plan`, args: { name: frm.doc.name }, freeze: true, freeze_message: __("Finding the shortest route...") })
				.then((r) => {
					frappe.show_alert({ message: __("Route optimized: {0} km", [r.message.total_distance_km]), indicator: "green" });
					frm.reload_doc();
				})
		).addClass("btn-primary");
		frm.add_custom_button(__("Customer Map"), () => frappe.set_route("customer-map"));
	},
});

frappe.ui.form.on("Beat Plan Stop", {
	stops_remove: render_route,
});

function render_route(frm) {
	const $wrapper = frm.get_field("route_map").$wrapper;
	const stops = (frm.doc.stops || []).filter((s) => s.latitude && s.longitude);
	if (!stops.length) return $wrapper.html(`<div class="text-muted small">${__("Add stops with located customers to see the route.")}</div>`);

	$wrapper.html('<div class="rm-route" style="height:420px;border-radius:10px;border:1px solid var(--border-color);z-index:0"></div>');
	if (frm.route_map) frm.route_map.remove();
	const map = (frm.route_map = L.map($wrapper.find(".rm-route")[0]));
	L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
		maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
	}).addTo(map);

	const points = [];
	if (frm.doc.start_latitude && frm.doc.start_longitude) {
		points.push([frm.doc.start_latitude, frm.doc.start_longitude]);
		L.marker(points[0]).bindTooltip(__("Start")).addTo(map);
	}
	stops.forEach((s) => {
		const latlng = [s.latitude, s.longitude];
		points.push(latlng);
		L.marker(latlng, {
			icon: L.divIcon({
				className: "",
				html: `<div style="background:${STOP_COLORS[s.status] || "#2563eb"};color:#fff;border:2px solid #fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;box-shadow:0 1px 4px rgba(0,0,0,.4)">${s.idx}</div>`,
				iconSize: [26, 26], iconAnchor: [13, 13],
			}),
		}).bindTooltip(`${s.idx}. ${frappe.utils.escape_html(s.customer_name || s.customer)} (${__(s.status)})`).addTo(map);
	});
	L.polyline(points, { color: "#2563eb", weight: 3, opacity: 0.7, dashArray: "6 6" }).addTo(map);
	map.fitBounds(L.latLngBounds(points).pad(0.2));
	setTimeout(() => map.invalidateSize(), 200);
}
