// Copyright (c) 2026, Gopal and contributors
// For license information, please see license.txt

const RM_API = "routemitra.routemitra_core.api.v1.maps";

const COLOR_MODES = {
	"Outstanding": {
		value: (c) => c.outstanding,
		legend: [["#16a34a", __("Nothing due")], ["#f59e0b", __("Due")], ["#dc2626", __("Top 25% due")]],
	},
	"Sales (90 days)": {
		value: (c) => c.sales_90d,
		legend: [["#9ca3af", __("No sales")], ["#60a5fa", __("Some sales")], ["#1d4ed8", __("Top 25% sales")]],
	},
	"Last Visit": {
		value: (c) => c.days_since_visit,
		legend: [["#16a34a", __("Visited in 30 days")], ["#f59e0b", __("30+ days ago")], ["#dc2626", __("Never visited")]],
	},
};

frappe.pages["customer-map"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Customer Map"), single_column: true });
	wrapper.customer_map = new CustomerMap(page);
};

frappe.pages["customer-map"].on_page_show = function (wrapper) {
	wrapper.customer_map && wrapper.customer_map.map && wrapper.customer_map.map.invalidateSize();
};

class CustomerMap {
	constructor(page) {
		this.page = page;
		this.selected = new Set();
		this.markers = {};
		this.make_filters();
		this.make_layout();
		this.make_buttons();
		const territory = frappe.utils.get_url_arg("territory");
		territory ? this.territory.set_value(territory) : this.load();
	}

	make_filters() {
		this.territory = this.page.add_field({
			fieldname: "territory", label: __("Territory"), fieldtype: "Link", options: "Territory",
			change: () => this.load(),
		});
		this.sales_person = this.page.add_field({
			fieldname: "sales_person", label: __("Sales Person"), fieldtype: "Link", options: "Sales Person",
			change: () => this.load(),
		});
		this.color_by = this.page.add_field({
			fieldname: "color_by", label: __("Colour By"), fieldtype: "Select",
			options: Object.keys(COLOR_MODES).join("\n"), default: "Outstanding",
			change: () => this.render(),
		});
	}

	make_layout() {
		// Append, don't replace: page.main also holds the filter bar (page-form).
		$(`
			<div class="rm-layout" style="display:flex;gap:12px;align-items:stretch;flex-wrap:wrap">
				<div class="rm-map" style="flex:1 1 560px;min-height:640px;border-radius:10px;border:1px solid var(--border-color);z-index:0"></div>
				<div class="rm-side" style="flex:0 1 320px;min-width:260px;display:flex;flex-direction:column;gap:12px">
					<div class="rm-stats frappe-card" style="padding:12px"></div>
					<div class="rm-selection frappe-card" style="padding:12px"></div>
				</div>
			</div>`).appendTo(this.page.main);
		this.$side = this.page.main.find(".rm-side");
		this.map = L.map(this.page.main.find(".rm-map")[0], { zoomControl: true });
		L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
			maxZoom: 19,
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
		}).addTo(this.map);
		this.layer = L.featureGroup().addTo(this.map);
		this.legend = L.control({ position: "bottomleft" });
		this.legend.onAdd = () => (this.$legend = $('<div class="rm-legend"></div>'))[0];
		this.legend.addTo(this.map);
		this.render_selection();
	}

	make_buttons() {
		this.page.set_primary_action(__("Plan Beat from Selection"), () => this.plan_beat(), "add");
		this.page.add_menu_item(__("Locate All Addresses"), () => this.locate_all());
		this.page.add_menu_item(__("RouteMitra Settings"), () => frappe.set_route("Form", "RouteMitra Settings"));
	}

	load() {
		frappe
			.call(`${RM_API}.get_map_data`, {
				territory: this.territory.get_value() || null,
				sales_person: this.sales_person.get_value() || null,
			})
			.then((r) => {
				this.data = r.message;
				this.render();
				this.fit();
			});
	}

	fit() {
		const s = this.data.settings;
		if (this.data.customers.length) this.map.fitBounds(this.layer.getBounds().pad(0.15));
		else this.map.setView([s.lat, s.lng], s.zoom);
	}

	render() {
		if (!this.data) return;
		const mode = COLOR_MODES[this.color_by.get_value() || "Outstanding"];
		const cutoff = this.top_quartile(this.data.customers.map(mode.value).filter((v) => v > 0));
		this.layer.clearLayers();
		this.markers = {};
		for (const c of this.data.customers) {
			const marker = L.circleMarker([c.lat, c.lng], {
				// Leaflet passes pin clicks on to the map, which would move "you are here" onto the pin.
				bubblingMouseEvents: false,
				radius: 9, weight: this.selected.has(c.customer) ? 4 : 1.5,
				color: this.selected.has(c.customer) ? "#111827" : "#ffffff",
				fillColor: this.color_for(c, mode, cutoff), fillOpacity: 0.9,
			});
			marker.bindTooltip(frappe.utils.escape_html(c.customer_name));
			marker.bindPopup(() => this.popup(c), { minWidth: 240 });
			marker.addTo(this.layer);
			this.markers[c.customer] = marker;
		}
		this.render_legend(mode);
		this.render_stats();
	}

	color_for(c, mode, cutoff) {
		const value = mode.value(c);
		const [low, mid, high] = mode.legend.map((l) => l[0]);
		if (mode === COLOR_MODES["Last Visit"]) {
			if (value === null || value === undefined) return high;
			return value > 30 ? mid : low;
		}
		if (!(value > 0)) return low; // zero, or a credit balance
		return value >= cutoff ? high : mid;
	}

	top_quartile(values) {
		if (!values.length) return Infinity;
		const sorted = [...values].sort((a, b) => a - b);
		return sorted[Math.floor(sorted.length * 0.75)];
	}

	popup(c) {
		const esc = frappe.utils.escape_html;
		const visit = c.last_visit ? __("{0} days ago", [c.days_since_visit]) : __("Never");
		const $el = $(`
			<div style="font-size:13px;line-height:1.5">
				<div style="font-weight:600;font-size:14px">${esc(c.customer_name)}</div>
				<div class="text-muted">${esc(c.territory || "")}${c.customer_group ? " · " + esc(c.customer_group) : ""}</div>
				<div style="margin-top:6px">${__("Outstanding")}: <b>${format_currency(c.outstanding)}</b></div>
				<div>${__("Sales, 90 days")}: <b>${format_currency(c.sales_90d)}</b></div>
				<div>${__("Last visit")}: <b>${visit}</b></div>
				<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
					<button class="btn btn-xs btn-default" data-action="open">${__("Open")}</button>
					<button class="btn btn-xs btn-default" data-action="order">${__("New Order")}</button>
					<button class="btn btn-xs btn-primary" data-action="select">${this.selected.has(c.customer) ? __("Remove from Plan") : __("Add to Plan")}</button>
				</div>
			</div>`);
		$el.on("click", "[data-action]", (e) => {
			const action = $(e.currentTarget).data("action");
			if (action === "open") frappe.set_route("Form", "Customer", c.customer);
			if (action === "order") frappe.new_doc("Sales Order", { customer: c.customer });
			if (action === "select") this.toggle(c.customer);
		});
		return $el[0];
	}

	toggle(customer) {
		this.selected.has(customer) ? this.selected.delete(customer) : this.selected.add(customer);
		this.map.closePopup();
		this.render();
		this.render_selection();
	}

	render_legend(mode) {
		this.$legend.html(`
			<div style="background:var(--card-bg);padding:8px 10px;border-radius:8px;box-shadow:var(--shadow-sm);font-size:12px">
				${mode.legend.map(([color, label]) => `
					<div style="display:flex;align-items:center;gap:6px">
						<span style="width:11px;height:11px;border-radius:50%;background:${color};display:inline-block"></span>${label}
					</div>`).join("")}
			</div>`);
	}

	render_stats() {
		const customers = this.data.customers;
		const due = customers.reduce((sum, c) => sum + c.outstanding, 0);
		const never = customers.filter((c) => !c.last_visit).length;
		this.$side.find(".rm-stats").html(`
			<div class="text-muted small">${__("On the map")}</div>
			<div style="font-size:22px;font-weight:600">${customers.length} ${__("customers")}</div>
			<div class="small" style="margin-top:6px">${__("Outstanding")}: <b>${format_currency(due)}</b></div>
			<div class="small">${__("Never visited")}: <b>${never}</b></div>
			${this.data.unlocated ? `<div class="small text-muted" style="margin-top:6px">${__("{0} customers have no located address yet.", [this.data.unlocated])}</div>` : ""}`);
	}

	render_selection() {
		const names = [...this.selected];
		const label = (name) => {
			const c = this.data && this.data.customers.find((x) => x.customer === name);
			return frappe.utils.escape_html(c ? c.customer_name : name);
		};
		this.$side.find(".rm-selection").html(`
			<div style="font-weight:600">${__("Beat Plan Selection")} (${names.length})</div>
			${names.length
				? `<ol class="small" style="padding-left:18px;margin:6px 0 0">${names.map((n) => `<li>${label(n)}</li>`).join("")}</ol>`
				: `<div class="small text-muted" style="margin-top:4px">${__("Click a pin and choose Add to Plan.")}</div>`}`);
	}

	plan_beat() {
		if (!this.selected.size) return frappe.msgprint(__("Add some customers to the selection first."));
		frappe.prompt(
			[
				{ fieldname: "sales_person", fieldtype: "Link", options: "Sales Person", label: __("Sales Person"), reqd: 1,
				  default: this.sales_person.get_value() },
				{ fieldname: "plan_date", fieldtype: "Date", label: __("Date"), reqd: 1, default: frappe.datetime.get_today() },
			],
			(values) =>
				frappe
					.call({ method: `${RM_API}.create_beat_plan`, args: { ...values, customers: [...this.selected] }, freeze: true })
					.then((r) => frappe.set_route("Form", "Beat Plan", r.message.beat_plan)),
			__("Create Beat Plan"),
			__("Create")
		);
	}

	locate_all() {
		frappe.call({ method: `${RM_API}.locate_pending_addresses`, freeze: true }).then((r) => {
			const n = r.message.queued;
			frappe.msgprint(n ? __("Locating {0} addresses in the background. Pins appear as they're found.", [n]) : __("Every address is already located."));
		});
		frappe.realtime.off("rm_geocoding_done");
		frappe.realtime.on("rm_geocoding_done", (counts) => {
			frappe.show_alert({ message: __("Addresses located: {0} exact, {1} approximate, {2} not found", [counts.Located || 0, counts.Approximate || 0, counts["Not Found"] || 0]), indicator: "green" }, 10);
			this.load();
		});
	}
}
