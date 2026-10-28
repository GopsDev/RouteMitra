// Copyright (c) 2026, Gopal and contributors
// For license information, please see license.txt

// Largest GPS error accepted without asking; phones outdoors are usually 5-30 m.
const RM_GPS_OK_M = 100;

frappe.ui.form.on("Address", {
	setup(frm) {
		// Locating runs in a background job after save; reload when it reports back.
		frappe.realtime.on("rm_address_located", (data) => {
			if (!frm.doc || data.address !== frm.doc.name) return;
			if (frm.is_dirty()) {
				frappe.show_alert({ message: __("Location found ({0}). Save or reload to see it.", [__(data.status)]), indicator: "blue" }, 8);
				return;
			}
			frm.reload_doc().then(() =>
				frappe.show_alert({ message: __("Location: {0}", [__(data.status)]), indicator: data.status === "Not Found" ? "orange" : "green" }, 6)
			);
		});
	},
	refresh(frm) {
		rm_show_locating(frm);
		if (frm.is_new()) return;
		frm.add_custom_button(__("Set Location from GPS"), () => rm_capture_gps(frm), __("Map Location"));
		if (frm.doc.latitude && frm.doc.longitude) {
			frm.add_custom_button(
				__("Open in Map"),
				() => window.open(`https://www.openstreetmap.org/?mlat=${frm.doc.latitude}&mlon=${frm.doc.longitude}#map=18/${frm.doc.latitude}/${frm.doc.longitude}`, "_blank"),
				__("Map Location")
			);
		}
	},
});

function rm_show_locating(frm) {
	// Empty status on a saved address means the background lookup hasn't finished yet.
	const pending = !frm.is_new() && !frm.doc.geocode_status && !frm.doc.latitude && !frm.doc.longitude;
	frm.set_intro(pending ? __("Finding this address on the map. The coordinates appear here in a few seconds.") : "", "blue");
}

function rm_capture_gps(frm) {
	if (!window.isSecureContext) {
		return frappe.msgprint(__("The browser only shares GPS with secure (https://) sites. Open this site over HTTPS on your phone."));
	}
	if (!navigator.geolocation) return frappe.msgprint(__("This browser can't share its location."));

	frappe.show_alert({ message: __("Getting your GPS position..."), indicator: "blue" });
	navigator.geolocation.getCurrentPosition(
		(pos) => {
			const { latitude, longitude, accuracy } = pos.coords;
			const save = () => rm_save_gps(frm, latitude, longitude, accuracy);
			if (accuracy > RM_GPS_OK_M) {
				frappe.confirm(
					__("This position is only accurate to ±{0} m, which usually means no real GPS (for example on a laptop). Save it as this shop's location anyway?", [Math.round(accuracy)]),
					save
				);
			} else {
				save();
			}
		},
		(err) => frappe.msgprint(__("Couldn't get your location: {0}", [err.message])),
		{ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
	);
}

function rm_save_gps(frm, latitude, longitude, accuracy) {
	// Wait for all three values before saving, or the save sends a half-updated form.
	frm.set_value({
		latitude: Number(latitude.toFixed(6)),
		longitude: Number(longitude.toFixed(6)),
		geocode_status: "GPS",
	})
		.then(() => frm.save())
		.then(() =>
			frappe.show_alert({ message: __("Shop location saved from GPS (±{0} m)", [Math.round(accuracy)]), indicator: "green" }, 6)
		);
}
