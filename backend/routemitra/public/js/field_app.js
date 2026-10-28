// Copyright (c) 2026, Gopal and contributors
// For license information, please see license.txt

// RouteMitra: the field sales mobile page (/routemitra). Plain JS: no Desk, so it loads fast on a phone.
// All rules (GPS, photo, fraud checks) are enforced on the server; this page only collects input.

(function () {
	const MAPS_API = "routemitra.routemitra_core.api.v1.maps";
	const FIELD_API = "routemitra.routemitra_core.api.v1.field";
	const TEST_ACCURACY_M = 10; // accuracy reported for the developer mode test location
	const PHOTO_MAX_PX = 1280; // photos are shrunk on the phone before upload
	const HOME_STOPS = 4; // stops shown on Home; the Routes tab has all of them
	const RELOAD_AFTER_MS = 60 * 1000; // coming back to the page after this long fetches the day again
	const NOTIFY_POLL_MS = 30 * 1000; // while the page is open, check this often for a manager's changes
	const TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
	const ICON = {
		navigate: '<svg viewBox="0 0 24 24"><path d="m3 11 18-8-8 18-2-8-8-2Z"/></svg>',
		pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>',
		clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
		check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
		flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4h11l-1 4 1 4H5"/></svg>',
		camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/></svg>',
		login: '<svg viewBox="0 0 24 24"><path d="M15 3h4v18h-4M10 17l5-5-5-5M15 12H3"/></svg>',
		logout: '<svg viewBox="0 0 24 24"><path d="M9 3H5v18h4M14 17l5-5-5-5M19 12H8"/></svg>',
		route: '<svg viewBox="0 0 24 24"><circle cx="5" cy="17" r="2"/><circle cx="19" cy="7" r="2"/><path d="M6.5 15.5 10 11l4 3 3.5-5.5"/></svg>',
		store: '<svg viewBox="0 0 24 24"><path d="M4 10v10h16V10M3 4h18l-1 6H4L3 4Zm6 16v-6h6v6"/></svg>',
		bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
		close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
		shield: '<svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
		refresh: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>',
		skip: '<svg viewBox="0 0 24 24"><path d="M5 5l10 7-10 7V5ZM19 5v14"/></svg>',
		dot: '<svg viewBox="0 0 24 24"><path d="M12 22s-8-7.5-8-13a8 8 0 0 1 16 0c0 5.5-8 13-8 13Z"/><circle cx="12" cy="9" r="3"/></svg>',
	};

	const $ = (id) => document.getElementById(id);
	const state = { day: null, position: null, tab: "home", timer: null, map: null, layer: null };

	// ---------- server ----------

	async function api(method, args = {}) {
		const response = await fetch(`/api/method/${method}`, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"X-Frappe-CSRF-Token": window.frappe.csrf_token || "",
			},
			body: JSON.stringify(args),
		});
		const data = await response.json().catch(() => ({}));
		if (response.status === 403 && /login|session/i.test(data.exc_type || "")) {
			window.location.href = "/login?redirect-to=/routemitra";
		}
		if (!response.ok) throw new Error(server_message(data) || `Request failed (${response.status})`);
		return data.message;
	}

	// Frappe sends errors as a JSON list of JSON-encoded messages that may contain HTML.
	function server_message(data) {
		try {
			const messages = JSON.parse(data._server_messages || "[]").map((m) => {
				const parsed = typeof m === "string" ? JSON.parse(m) : m;
				return strip_html(parsed.message || "");
			});
			if (messages.length) return messages.join(" ");
		} catch (e) {
			// Fall through to the exception text.
		}
		return strip_html(data.exception || data.message || "");
	}

	function strip_html(html) {
		const div = document.createElement("div");
		div.innerHTML = html;
		return div.textContent.trim();
	}

	function esc(text) {
		const div = document.createElement("div");
		div.textContent = text == null ? "" : String(text);
		return div.innerHTML;
	}

	// ---------- feedback ----------

	let toast_timeout;
	function toast(message, kind = "", ms = 4000) {
		const el = $("toast");
		el.textContent = message;
		el.className = `toast ${kind}`;
		clearTimeout(toast_timeout);
		toast_timeout = setTimeout(() => el.classList.add("hidden"), ms);
	}

	function busy(text) {
		$("busy-text").textContent = text || "";
		$("busy").classList.toggle("hidden", !text);
	}

	async function run(text, fn) {
		busy(text);
		try {
			return await fn();
		} catch (error) {
			toast(error.message, "error", 7000);
			throw error;
		} finally {
			busy(null);
		}
	}

	// ---------- GPS and camera ----------

	function get_position() {
		const test = state.day && state.day.settings.test_location;
		if (test) {
			state.position = { lat: test.lat, lng: test.lng, accuracy: TEST_ACCURACY_M };
			return Promise.resolve(state.position);
		}
		return new Promise((resolve, reject) => {
			if (!window.isSecureContext) return reject(new Error("GPS only works on a secure (https://) address."));
			if (!navigator.geolocation) return reject(new Error("This phone's browser can't share its location."));
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					state.position = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
					resolve(state.position);
				},
				(err) => reject(new Error(err.code === 1 ? "Location permission is blocked. Allow location for this site in the browser settings." : `Couldn't get your location: ${err.message}`)),
				// maximumAge 0: never reuse a cached (possibly old) position.
				{ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
			);
		});
	}

	// Shows "You" on the map and distances on the stops. Quiet: errors only matter at check-in.
	async function locate_quietly() {
		try {
			await get_position();
			render_map(state.day);
			render_stops(state.day);
			render_checks(state.day);
		} catch (error) {
			// The rep sees the real error when they check in.
		}
	}

	// An image or video frame as a JPEG data URL, no larger than PHOTO_MAX_PX on its long side.
	function to_jpeg(source, width, height) {
		const scale = Math.min(1, PHOTO_MAX_PX / Math.max(width, height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(height * scale);
		canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL("image/jpeg", 0.8);
	}

	function shrink_photo(file) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				URL.revokeObjectURL(img.src);
				resolve(to_jpeg(img, img.width, img.height));
			};
			img.onerror = () => reject(new Error("That photo couldn't be read. Take it again."));
			img.src = URL.createObjectURL(file);
		});
	}

	// Shop photos come only from the live camera shown in the page, never from the gallery or a file,
	// so an old photo can't be passed off as today's visit. Browsers only share the camera with
	// https:// or localhost. Without that, a phone falls back to its native camera input (which some
	// phones let the rep swap for the gallery), and the visit is flagged; a laptop can't check in at all.
	const IS_LAPTOP = !window.matchMedia("(pointer: coarse)").matches;
	const CAN_USE_CAMERA = window.isSecureContext && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
	let camera_stream = null;

	async function start_camera(video) {
		stop_camera();
		try {
			camera_stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
				audio: false,
			});
		} catch (error) {
			const message = {
				NotAllowedError: "Camera permission is blocked. Allow the camera for this site in the browser settings.",
				NotFoundError: "No camera found on this device.",
				NotReadableError: "The camera is in use by another app. Close that app and try again.",
			}[error.name];
			throw new Error(message || `Couldn't open the camera: ${error.message}`);
		}
		video.srcObject = camera_stream;
		await video.play();
	}

	function stop_camera() {
		if (!camera_stream) return;
		camera_stream.getTracks().forEach((track) => track.stop());
		camera_stream = null;
	}

	// ---------- bottom sheet ----------

	function open_sheet(title, html) {
		$("sheet-title").textContent = title;
		$("sheet-body").innerHTML = html;
		$("sheet").classList.remove("hidden");
		return $("sheet-body");
	}

	function close_sheet() {
		stop_camera();
		$("sheet").classList.add("hidden");
		$("sheet-body").innerHTML = "";
	}

	// ---------- check in / out ----------

	function start_check_in(customer, customer_name, beat_plan) {
		if (state.day.open_visit) {
			return toast(`Check out of ${state.day.open_visit.customer_name} first.`, "error");
		}
		if (!state.day.settings.require_photo) return confirm_check_in({ customer, customer_name, beat_plan, photo: null }).catch(() => {});

		let photo = null;
		let photo_source = null;
		const tap = IS_LAPTOP ? "Click" : "Tap";
		let picker;
		if (CAN_USE_CAMERA) {
			picker = `<button class="photo-drop" id="take-photo">${ICON.camera}<span>${tap} to open camera</span></button>`;
		} else if (!IS_LAPTOP) {
			picker = `<div class="photo-picker">
					<label class="photo-drop" id="take-photo" for="photo-input">${ICON.camera}<span>Tap to open camera</span></label>
					<input type="file" accept="image/*" capture="environment" id="photo-input" aria-label="Take shop photo">
				</div>`;
		} else {
			picker = `<p class="notice-box">The camera only works when this page is opened over a secure (https://) address. Ask your manager for the right link.</p>`;
		}
		const body = open_sheet(`Check in at ${customer_name}`, `
			<p class="sheet-sub">Take a photo of the shop front. It is saved with the visit.</p>
			<div class="photo-preview"></div>
			<div class="webcam hidden">
				<video playsinline muted></video>
				<div class="card-actions">
					<button class="btn" id="camera-cancel">Close Camera</button>
					<button class="btn btn-primary" id="camera-capture">${ICON.camera} Capture</button>
				</div>
			</div>
			${picker}
			<div class="card-actions" id="sheet-actions">
				<button class="btn" id="sheet-cancel">Cancel</button>
				<button class="btn btn-primary" id="sheet-confirm" disabled>Check In</button>
			</div>`);
		const webcam = body.querySelector(".webcam");
		const video = webcam.querySelector("video");
		body.querySelector("#sheet-cancel").onclick = close_sheet;

		const set_photo = (data, source) => {
			photo = data;
			photo_source = source;
			body.querySelector(".photo-preview").innerHTML = `<img src="${photo}" alt="Shop photo">`;
			const retake = body.querySelector("#take-photo");
			retake.className = "btn btn-block";
			retake.innerHTML = `${ICON.camera} Retake`;
			body.querySelector("#sheet-confirm").disabled = false;
		};
		// While the webcam is showing, only its own buttons are offered.
		const show_webcam = (on) => {
			webcam.classList.toggle("hidden", !on);
			body.querySelector(".photo-preview").classList.toggle("hidden", on);
			body.querySelectorAll("#take-photo, #sheet-actions").forEach((el) => el.classList.toggle("hidden", on));
			if (!on) stop_camera();
		};

		if (CAN_USE_CAMERA) {
			body.querySelector("#take-photo").onclick = async () => {
				show_webcam(true);
				try {
					await start_camera(video);
				} catch (error) {
					show_webcam(false);
					toast(error.message, "error", 7000);
				}
			};
			body.querySelector("#camera-cancel").onclick = () => show_webcam(false);
			body.querySelector("#camera-capture").onclick = () => {
				if (!video.videoWidth) return toast("The camera is still starting. Try again in a second.", "error");
				const data = to_jpeg(video, video.videoWidth, video.videoHeight);
				show_webcam(false);
				set_photo(data, "camera");
			};
		} else if (!IS_LAPTOP) {
			// capture="environment" opens the rear camera directly instead of the gallery.
			// The real input sits invisibly on top of the button, so the tap lands on it directly:
			// some mobile browsers ignore a scripted input.click() or a label pointing at a hidden input.
			const input = body.querySelector("#photo-input");
			input.onchange = async () => {
				const file = input.files && input.files[0];
				if (!file) return;
				try {
					set_photo(await shrink_photo(file), "file");
				} catch (error) {
					toast(error.message, "error");
				}
				input.value = "";
			};
		}
		body.querySelector("#sheet-confirm").onclick = () => {
			close_sheet();
			confirm_check_in({ customer, customer_name, beat_plan, photo, photo_source }).catch(() => {});
		};
	}

	async function confirm_check_in({ customer, beat_plan, photo, photo_source }) {
		const result = await run("Getting your GPS position…", async () => {
			const pos = await get_position();
			busy("Checking in…");
			return api(`${MAPS_API}.check_in`, {
				customer, beat_plan, photo, photo_source,
				latitude: pos.lat, longitude: pos.lng, accuracy_m: pos.accuracy,
			});
		});
		const kind = result.is_suspicious ? "error" : result.status === "Verified" ? "success" : "";
		const note = result.is_suspicious ? " Flagged for your manager to review." : "";
		toast(`Checked in: ${result.status}, ${result.distance_m} m from the shop.${note}`, kind, 7000);
		await load();
		show_tab("home");
	}

	// Outcome and notes are asked for in a sheet; Save keeps them without checking out.
	function start_check_out() {
		const visit = state.day.open_visit;
		if (!visit) return;
		const choices = state.day.outcomes.map((o) => `
			<label class="choice"><input type="radio" name="visit-outcome" value="${esc(o)}" ${o === visit.outcome ? "checked" : ""}><span>${esc(o)}</span></label>`).join("");
		const body = open_sheet(`Check out of ${visit.customer_name}`, `
			<p class="sheet-sub">Checked in at ${esc(time_of(visit.checkin_time))}${state.day.settings.min_visit_minutes ? ` · stay at least ${state.day.settings.min_visit_minutes} min` : ""}</p>
			<div class="field">What happened?<div class="choices">${choices}</div></div>
			<label class="field">Notes<textarea id="visit-notes" placeholder="Order details, follow-up, anything useful">${esc(visit.notes || "")}</textarea></label>
			<div class="card-actions">
				<button class="btn" id="save-outcome">Save</button>
				<button class="btn btn-green" id="check-out">${ICON.logout} Check Out</button>
			</div>`);
		const read_form = () => {
			const picked = body.querySelector("input[name=visit-outcome]:checked");
			return { outcome: picked ? picked.value : "", notes: body.querySelector("#visit-notes").value };
		};
		body.querySelector("#save-outcome").onclick = () => {
			const form = read_form();
			close_sheet();
			save_outcome(form).catch(() => {});
		};
		body.querySelector("#check-out").onclick = () => {
			const form = read_form();
			if (!form.outcome) return toast("Choose what happened at the shop before checking out.", "error");
			close_sheet();
			check_out(form).catch(() => {});
		};
	}

	async function check_out({ outcome, notes }) {
		const visit = state.day.open_visit;
		const result = await run("Saving…", async () => {
			await api(`${FIELD_API}.save_visit_outcome`, { sales_visit: visit.name, outcome, notes });
			busy("Getting your GPS position…");
			const pos = await get_position();
			busy("Checking out…");
			return api(`${MAPS_API}.check_out`, {
				sales_visit: visit.name, latitude: pos.lat, longitude: pos.lng, accuracy_m: pos.accuracy,
			});
		});
		const note = result.is_suspicious ? " Flagged for your manager to review." : "";
		toast(`Checked out after ${result.duration_minutes} min.${note}`, result.is_suspicious ? "error" : "success", 7000);
		await load();
	}

	async function save_outcome({ outcome, notes }) {
		const visit = state.day.open_visit;
		await run("Saving…", () => api(`${FIELD_API}.save_visit_outcome`, { sales_visit: visit.name, outcome, notes }));
		visit.outcome = outcome;
		visit.notes = notes;
		toast("Saved.", "success");
	}

	// The rep can't make it to a shop on today's route: say why, so the manager knows.
	function start_skip(customer, customer_name, beat_plan) {
		const body = open_sheet(`Skip ${customer_name}?`, `
			<p class="sheet-sub">Your manager sees this reason.</p>
			<div class="choices">${state.day.skip_reasons.map((r, i) => `
				<label class="choice"><input type="radio" name="skip-reason" value="${esc(r)}" ${i ? "" : "checked"}><span>${esc(r)}</span></label>`).join("")}
			</div>
			<label class="field">Note (optional)<textarea id="skip-note" placeholder="Anything your manager should know"></textarea></label>
			<div class="card-actions">
				<button class="btn" id="sheet-cancel">Cancel</button>
				<button class="btn btn-primary" id="skip-confirm">Skip Shop</button>
			</div>`);
		body.querySelector("#sheet-cancel").onclick = close_sheet;
		body.querySelector("#skip-confirm").onclick = async () => {
			const reason = body.querySelector("input[name=skip-reason]:checked").value;
			const note = body.querySelector("#skip-note").value;
			close_sheet();
			try {
				await run("Saving…", () => api(`${FIELD_API}.skip_stop`, { beat_plan, customer, reason, note }));
				toast(`${customer_name} skipped: ${reason}.`, "", 5000);
				await load();
			} catch (error) {
				// Shown by run().
			}
		};
	}

	// Tapping a stop on Home or on the map: its details and what the rep can do there.
	function open_stop(stop) {
		const day = state.day;
		const name = stop.customer_name || stop.customer;
		const info = stop_info(stop, day);
		const located = stop.latitude && stop.longitude;
		const can_act = stop.status === "Planned" && !day.open_visit;
		const body = open_sheet(name, `
			<div class="sheet-meta">
				<span>${esc(stop.address || "No address")}</span>
				<span>Stop ${stop.idx} · ${esc(info.label)}${located && state.position ? ` · ${km_from_me(stop.latitude, stop.longitude)} away` : ""}</span>
			</div>
			${info.kind === "active" ? `<button class="btn btn-green btn-block" id="stop-checkout">${ICON.logout} Check Out</button>` : ""}
			${stop.status === "Planned" ? `
			<div class="card-actions">
				${located ? `<a class="btn btn-soft" href="${directions_url(stop.latitude, stop.longitude)}" target="_blank" rel="noopener">${ICON.navigate} Navigate</a>` : ""}
				<button class="btn btn-primary" id="stop-checkin" ${can_act ? "" : "disabled"}>${ICON.pin} Check In</button>
			</div>
			<button class="link-btn skip-link" id="stop-skip">Can't visit? Skip</button>` : ""}`);
		const checkin = body.querySelector("#stop-checkin");
		if (checkin) checkin.onclick = () => {
			close_sheet();
			start_check_in(stop.customer, name, stop.beat_plan);
		};
		const skip = body.querySelector("#stop-skip");
		if (skip) skip.onclick = () => start_skip(stop.customer, name, stop.beat_plan);
		const checkout = body.querySelector("#stop-checkout");
		if (checkout) checkout.onclick = start_check_out;
	}

	// ---------- rendering ----------

	function render() {
		const day = state.day;
		const date = parse_datetime(`${day.today} 00:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
		$("today-label").textContent = `Today · ${date}`;
		$("avatar").textContent = initials(day.user_name);
		$("rep-status").textContent = day.open_visit ? "On a visit" : day.sales_person ? "Field Rep · Active" : "Not linked";
		$("rep-status").className = `pill ${day.open_visit ? "green" : day.sales_person ? "teal" : "orange"}`;
		$("bell-dot").classList.toggle("hidden", !unread(day).length);
		$("checkin-count").textContent = day.visits.length || "";
		$("checkin-count").classList.toggle("hidden", !day.visits.length);
		render_notices(day);
		render_actions(day);
		render_open_visit(day);
		render_stops(day);
		render_checks(day);
		render_checkins(day);
		render_profile(day);
		render_map(day);
	}

	function all_stops(day) {
		return day.plans.flatMap((plan) => plan.stops.map((stop) => ({ ...stop, beat_plan: plan.name })));
	}

	function next_stop(day) {
		return all_stops(day).find((s) => s.status === "Planned");
	}

	// How a stop looks: its kind (for icon and colour), a label, a sub line and a chip.
	function stop_info(stop, day) {
		const visit = day.visits.find((v) => v.name === stop.sales_visit || (!stop.sales_visit && v.customer === stop.customer));
		const is_open = day.open_visit && day.open_visit.customer === stop.customer && stop.status !== "Skipped";
		if (is_open) {
			return { kind: "active", label: "Active", sub: `Checked in ${time_of(day.open_visit.checkin_time)} · In progress`, chip: ["orange", "In progress"] };
		}
		if (stop.status === "Visited") {
			const sub = visit ? `Checked in ${time_of(visit.checkin_time)}${visit.duration_minutes ? ` · ${visit.duration_minutes} min` : ""}` : "Visited";
			let chip = ["green", "Done"];
			if (visit && visit.order_total) chip = ["teal", `Order: ${money(visit.order_total, visit.order_currency)}`];
			else if (visit && visit.is_suspicious) chip = ["red", "Flagged"];
			else if (visit && visit.outcome) chip = ["teal", visit.outcome];
			return { kind: "done", label: "Completed", sub, chip };
		}
		if (stop.status === "Skipped") return { kind: "skipped", label: "Skipped", sub: stop.skip_reason || "Skipped", chip: ["orange", "Skipped"] };
		if (stop.status === "Missed") return { kind: "missed", label: "Missed", sub: stop.address || "Not visited", chip: ["red", "Missed"] };
		const next = next_stop(day);
		const is_next = next && next.customer === stop.customer && next.beat_plan === stop.beat_plan;
		const away = stop.latitude && stop.longitude && state.position ? ` · ${km_from_me(stop.latitude, stop.longitude)} away` : "";
		return {
			kind: is_next ? "next" : "planned",
			label: is_next ? "Next" : "Upcoming",
			sub: `${stop.address || "No address"}${away}`,
			chip: is_next ? ["teal", "Next"] : ["", `Stop ${stop.idx}`],
		};
	}

	function stop_icon(stop, info) {
		if (info.kind === "done") return ICON.check;
		if (info.kind === "active") return ICON.dot;
		if (info.kind === "skipped") return ICON.skip;
		if (info.kind === "missed") return ICON.close;
		if (info.kind === "next") return String(stop.idx);
		return "";
	}

	function stop_row(stop, day, key) {
		const info = stop_info(stop, day);
		return `
			<button class="stop-row" data-stop="${key}">
				<span class="stop-icon ${info.kind}">${stop_icon(stop, info)}</span>
				<span class="stop-text">
					<span class="stop-title"><b>${esc(stop.customer_name || stop.customer)}</b>${info.kind === "done" || info.kind === "active" ? ` <span>— ${esc(info.label)}</span>` : ""}</span>
					<span class="stop-sub">${esc(info.sub)}</span>
				</span>
				<span class="pill ${info.chip[0]}">${esc(info.chip[1])}</span>
			</button>`;
	}

	function render_notices(day) {
		const notices = [];
		if (!day.sales_person) notices.push("Your login isn't linked to a Sales Person, so you have no route. Ask your manager to link your Employee record to a Sales Person.");
		if (day.settings.test_location) notices.push("Test location is on (developer mode): GPS is simulated.");
		else if (!window.isSecureContext) notices.push("This page isn't on https://, so the phone won't share GPS. Check-in won't work.");
		$("notices").innerHTML = notices.map((n) => `<div>${esc(n)}</div>`).join("");
	}

	// The two big buttons: Check-In goes to the next stop on the route, Check-Out closes the open visit.
	function render_actions(day) {
		const next = next_stop(day);
		$("btn-checkin").disabled = !!day.open_visit || !next;
		$("btn-checkout").disabled = !day.open_visit;
		let hint = "";
		if (day.open_visit) hint = `Check out of ${day.open_visit.customer_name} before the next shop.`;
		else if (next) hint = `Next: ${next.customer_name || next.customer}`;
		else if (all_stops(day).length) hint = "All stops on today's route are done.";
		$("action-hint").textContent = hint;
	}

	function render_open_visit(day) {
		const el = $("open-visit");
		clearInterval(state.timer);
		const visit = day.open_visit;
		if (!visit) return (el.innerHTML = "");
		el.innerHTML = `
			<div class="open-visit">
				<div class="open-visit-text">
					<div class="open-label"><span class="live-dot"></span>AT THE SHOP NOW</div>
					<div class="open-name">${esc(visit.customer_name)}</div>
					<div class="open-sub">${esc(visit.is_suspicious ? "Flagged" : visit.status)} · ${visit.distance_m != null ? `${esc(visit.distance_m)} m from the pin` : "checked in"}</div>
				</div>
				<div class="timer" id="visit-timer">0:00</div>
			</div>`;
		const started = parse_datetime(visit.checkin_time);
		const tick = () => {
			const seconds = Math.max(0, Math.floor((Date.now() - started.getTime()) / 1000));
			const h = Math.floor(seconds / 3600);
			const m = Math.floor((seconds % 3600) / 60);
			const s = String(seconds % 60).padStart(2, "0");
			$("visit-timer").textContent = h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
		};
		tick();
		state.timer = setInterval(tick, 1000);
	}

	// Home shows the last finished stop and the next few; Routes shows every stop with its buttons.
	function render_stops(day) {
		const stops = all_stops(day);
		state.stops = stops;
		const finished = stops.filter((s) => s.status !== "Planned").length;
		$("plan-count").textContent = `${finished}/${stops.length} Completed`;
		$("plan-count").classList.toggle("hidden", !stops.length);

		const home = [];
		for (let i = stops.length - 1; i >= 0; i--) {
			if (stops[i].status !== "Planned") {
				home.push(i);
				break;
			}
		}
		stops.forEach((stop, i) => {
			if (stop.status === "Planned" && home.length < HOME_STOPS) home.push(i);
		});
		home.sort((a, b) => a - b);

		if (!stops.length) {
			$("home-stops").innerHTML = empty("route", "No route planned today", "Your manager plans your Beat Plan. It shows up here once it's ready.");
		} else {
			$("home-stops").innerHTML = home.map((i) => stop_row(stops[i], day, i)).join("");
		}
		const more = stops.length - home.length;
		$("see-all").textContent = `View full route (${stops.length} stops)`;
		$("see-all").classList.toggle("hidden", more <= 0);
		bind_stops($("home-stops"));
		render_routes(day);
	}

	function render_routes(day) {
		const el = $("panel-routes");
		const stops = state.stops;
		if (!stops.length) {
			el.innerHTML = empty("route", "No route planned today", "Your Beat Plan shows up here once your manager plans it.");
			return;
		}
		const km = day.plans.reduce((sum, p) => sum + (p.total_distance_km || 0), 0);
		const next = next_stop(day);
		el.innerHTML = `
			<div class="section-head">
				<h2>Today's route</h2>
				<span class="section-sub">${stops.length} stops${km ? ` · ${km.toFixed(1)} km` : ""}</span>
			</div>
			${route_url(day) ? `<a class="btn btn-soft btn-block" href="${route_url(day)}" target="_blank" rel="noopener">${ICON.navigate} Open route in Google Maps</a>` : ""}
			<div class="stop-list">${stops.map((stop, i) => {
				const located = stop.latitude && stop.longitude;
				const is_next = next && next.customer === stop.customer;
				const name = stop.customer_name || stop.customer;
				return `
				<div class="stop-card ${is_next ? "is-next" : ""}">
					${stop_row(stop, day, i)}
					${stop.status === "Planned" ? `
					<div class="card-actions">
						${located ? `<a class="btn btn-soft" href="${directions_url(stop.latitude, stop.longitude)}" target="_blank" rel="noopener">${ICON.navigate} Navigate</a>` : ""}
						<button class="btn btn-primary" data-checkin="${esc(stop.customer)}" data-name="${esc(name)}" data-plan="${esc(stop.beat_plan)}" ${day.open_visit ? "disabled" : ""}>${ICON.pin} Check In</button>
					</div>
					<button class="link-btn skip-link" data-skip="${esc(stop.customer)}" data-name="${esc(name)}" data-plan="${esc(stop.beat_plan)}">Can't visit? Skip</button>` : ""}
				</div>`;
			}).join("")}</div>`;
		bind_stops(el);
		el.querySelectorAll("[data-checkin]").forEach((button) => {
			button.onclick = () => start_check_in(button.dataset.checkin, button.dataset.name, button.dataset.plan || null);
		});
		el.querySelectorAll("[data-skip]").forEach((button) => {
			button.onclick = () => start_skip(button.dataset.skip, button.dataset.name, button.dataset.plan);
		});
	}

	function bind_stops(el) {
		el.querySelectorAll("[data-stop]").forEach((row) => {
			row.onclick = () => open_stop(state.stops[Number(row.dataset.stop)]);
		});
	}

	// What the server checks on every visit, shown so the rep knows visits are verified.
	function render_checks(day) {
		const visits = day.visits;
		const flagged = visits.filter((v) => v.is_suspicious).length;
		const inside = visits.filter((v) => v.status === "Verified").length;
		const lines = [];
		if (visits.length) lines.push([inside === visits.length, `GPS: ${inside} of ${visits.length} visits inside the shop radius`]);
		else lines.push([true, `GPS: check in within ${day.settings.checkin_radius} m of the shop`]);
		lines.push([true, day.settings.require_photo ? "Photos: live camera only, no gallery" : "Photos: not required"]);
		if (state.position) lines.push([state.position.accuracy <= 50, `Location accuracy: ±${Math.round(state.position.accuracy)} m`]);
		if (flagged) lines.push([false, `${flagged} visit${flagged > 1 ? "s" : ""} flagged for your manager`]);
		$("checks").innerHTML = `
			<div class="checks">
				<div class="checks-head">
					${ICON.shield}
					<h3>Fraud Detection</h3>
					<span class="pill ${flagged ? "red" : "green"}">${flagged ? "Review" : "Secure"}</span>
				</div>
				<ul>${lines.map(([ok, text]) => `<li class="${ok ? "" : "warn"}">${ok ? ICON.check : ICON.flag}<span>${esc(text)}</span></li>`).join("")}</ul>
			</div>`;
	}

	function render_checkins(day) {
		const el = $("panel-checkins");
		if (!day.visits.length) {
			el.innerHTML = empty("check", "No check-ins yet today", "Your visits show up here after you check in.");
			return;
		}
		const minutes = day.visits.reduce((sum, v) => sum + (v.duration_minutes || 0), 0);
		const flagged = day.visits.filter((v) => v.is_suspicious).length;
		el.innerHTML = `
			<div class="section-head"><h2>Check-ins</h2><span class="section-sub">${day.visits.length} today</span></div>
			<div class="summary">
				<div><b>${day.visits.length}</b><span>Visits</span></div>
				<div><b>${minutes}m</b><span>In shops</span></div>
				<div class="${flagged ? "flagged" : ""}"><b>${flagged}</b><span>Flagged</span></div>
			</div>
			<div class="stop-list">${day.visits.map((v) => {
				const tone = v.is_suspicious ? "red" : v.status === "Verified" ? "green" : v.status === "Outside Radius" ? "orange" : "";
				const icon_kind = v.is_suspicious ? "missed" : v.checkout_time ? "done" : "active";
				const icon = v.is_suspicious ? ICON.flag : v.checkout_time ? ICON.check : ICON.dot;
				const when = `${time_of(v.checkin_time)}${v.checkout_time ? ` – ${time_of(v.checkout_time)} · ${v.duration_minutes} min` : " · still open"}`;
				const extra = v.order_total ? ` · Order ${money(v.order_total, v.order_currency)}` : v.outcome ? ` · ${v.outcome}` : "";
				return `
				<div class="stop-row" style="cursor: default">
					<span class="stop-icon ${icon_kind}">${icon}</span>
					<span class="stop-text">
						<span class="stop-title"><b>${esc(v.customer_name)}</b></span>
						<span class="stop-sub">${esc(when + extra)}</span>
					</span>
					<span class="pill ${tone}">${esc(v.is_suspicious ? "Flagged" : v.status)}</span>
				</div>`;
			}).join("")}</div>`;
	}

	function render_profile(day) {
		$("panel-profile").innerHTML = `
			<div class="profile-card">
				<div class="profile-avatar">${initials(day.user_name)}</div>
				<div class="profile-name">${esc(day.user_name)}</div>
				<div class="profile-sub">${esc(day.sales_person || "No Sales Person linked")}</div>
				<div class="profile-sub">${esc(day.user || "")}</div>
			</div>
			<div class="menu">
				<button class="menu-item" id="profile-updates">${ICON.bell} Updates${unread(day).length ? ` (${unread(day).length})` : ""}</button>
				<button class="menu-item" id="profile-refresh">${ICON.refresh} Refresh</button>
				<button class="menu-item danger" id="logout">${ICON.logout} Log out</button>
			</div>`;
		$("profile-updates").onclick = open_updates;
		$("profile-refresh").onclick = refresh;
		// Frappe only accepts logout as a POST, so a plain link would leave the rep signed in.
		$("logout").onclick = async () => {
			try {
				await api("logout");
			} catch (error) {
				// The session may already be gone; the login page is the right place either way.
			}
			// No redirect-to: whoever logs in next goes to their own home (reps to /routemitra, others to the Desk).
			window.location.href = "/login";
		};
	}

	// Notifications for the rep: new route, visit approved/rejected. Dismissing marks them read.
	function unread(day) {
		return (day.notifications || []).filter((n) => !n.read);
	}

	// Last week's updates. Read ones stay, faded; the tick marks one read.
	function open_updates() {
		const day = state.day;
		const items = day.notifications || [];
		if (!items.length) {
			open_sheet("Updates", empty("bell", "No updates this week", "New routes and visit reviews show up here."));
			return;
		}
		const body = open_sheet("Updates", `
			<div>${items.map((n) => `
				<div class="update${n.read ? " read" : ""}">
					<div class="update-text">${esc(strip_html(n.subject))}<span>${esc(ago(n.creation))}</span></div>
					${n.read ? "" : `<button class="update-close" data-read="${esc(n.name)}" aria-label="Mark read">${ICON.check}</button>`}
				</div>`).join("")}
			</div>
			${unread(day).length ? '<button class="btn btn-block" id="updates-clear">Mark all read</button>' : ""}`);
		const mark_read = (names) =>
			api(`${FIELD_API}.mark_notifications_read`, names ? { names } : {})
				.then(() => {
					items.forEach((n) => {
						if (!names || names.includes(n.name)) n.read = 1;
					});
					render();
					open_updates();
				})
				.catch((error) => toast(error.message, "error"));
		body.querySelectorAll("[data-read]").forEach((b) => (b.onclick = () => mark_read([b.dataset.read])));
		const clear = body.querySelector("#updates-clear");
		if (clear) clear.onclick = () => mark_read(null);
	}

	// ---------- map ----------

	function render_map(day) {
		const stops = all_stops(day).filter((s) => s.latitude && s.longitude);
		const km = day.plans.reduce((sum, p) => sum + (p.total_distance_km || 0), 0);
		const chip = $("map-chip");
		chip.innerHTML = `${ICON.route}<span>${km ? `${km.toFixed(1)} km · ` : ""}${all_stops(day).length} stops</span>`;
		chip.classList.toggle("hidden", !all_stops(day).length);

		if (!window.L) {
			show_map_message("The map needs an internet connection.");
			return;
		}
		if (!stops.length && !state.position) {
			show_map_message(all_stops(day).length ? "Your shops have no map location yet." : "No route planned today.");
			return;
		}
		show_map_message("");
		if (!state.map) {
			state.map = L.map("map", { zoomControl: false, attributionControl: true });
			L.tileLayer(TILES, { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(state.map);
			L.control.zoom({ position: "bottomright" }).addTo(state.map);
			state.layer = L.layerGroup().addTo(state.map);
		}
		state.layer.clearLayers();

		const points = stops.map((s) => [s.latitude, s.longitude]);
		if (points.length > 1) {
			L.polyline(points, { color: getComputedStyle(document.documentElement).getPropertyValue("--route").trim() || "#2563eb", weight: 5, opacity: 0.85 }).addTo(state.layer);
		}
		stops.forEach((stop) => {
			const info = stop_info(stop, day);
			const kind = info.kind === "done" ? "done" : info.kind;
			const label = info.kind === "done" ? ICON.check : info.kind === "skipped" ? "!" : String(stop.idx);
			const marker = L.marker([stop.latitude, stop.longitude], {
				icon: L.divIcon({ className: "", html: `<div class="pin pin-${kind}"><span>${label}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30] }),
				zIndexOffset: info.kind === "next" || info.kind === "active" ? 1000 : 0,
			}).addTo(state.layer);
			const show_name = info.kind === "next" || info.kind === "active";
			marker.bindTooltip(esc(stop.customer_name || stop.customer), { permanent: show_name, direction: "right", offset: [12, -16], className: "map-label" });
			marker.on("click", () => open_stop(stop));
		});
		if (state.position) {
			const you = [state.position.lat, state.position.lng];
			L.marker(you, { icon: L.divIcon({ className: "", html: '<div class="you-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) })
				.bindTooltip("You", { permanent: true, direction: "bottom", offset: [0, 10], className: "map-label" })
				.addTo(state.layer);
			points.push(you);
		}
		if (points.length === 1) state.map.setView(points[0], 15);
		else state.map.fitBounds(points, { padding: [36, 36], maxZoom: 16 });
	}

	function show_map_message(text) {
		$("map-empty").textContent = text;
		$("map-empty").classList.toggle("hidden", !text);
	}

	// ---------- helpers ----------

	function initials(name) {
		const words = String(name || "?").trim().split(/\s+/);
		return esc((words[0][0] + (words.length > 1 ? words[1][0] : "")).toUpperCase());
	}

	function empty(icon, title, text) {
		return `<div class="empty"><div class="empty-icon">${ICON[icon]}</div><b>${title}</b>${text}</div>`;
	}

	function money(amount, currency) {
		try {
			return new Intl.NumberFormat([], { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(amount);
		} catch (e) {
			return `${currency || ""} ${Math.round(amount)}`.trim();
		}
	}

	function ago(value) {
		const minutes = Math.max(0, Math.round((Date.now() - parse_datetime(value).getTime()) / 60000));
		if (minutes < 1) return "just now";
		if (minutes < 60) return `${minutes} min ago`;
		if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
		return parse_datetime(value).toLocaleDateString([], { day: "numeric", month: "short" });
	}

	function directions_url(lat, lng) {
		return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
	}

	// The stops still to visit, in order, as one Google Maps route from where the rep is now.
	// Google Maps links take up to 9 waypoints plus the destination; the rest are left for later.
	function route_url(day) {
		const left = all_stops(day).filter((s) => s.status === "Planned" && s.latitude && s.longitude).slice(0, 10);
		if (!left.length) return null;
		const last = left[left.length - 1];
		let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${last.latitude},${last.longitude}`;
		const waypoints = left.slice(0, -1).map((s) => `${s.latitude},${s.longitude}`);
		if (waypoints.length) url += `&waypoints=${encodeURIComponent(waypoints.join("|"))}`;
		return url;
	}

	function km_from_me(lat, lng) {
		const rad = (d) => (d * Math.PI) / 180;
		const p = state.position;
		const a = Math.sin(rad(lat - p.lat) / 2) ** 2 + Math.cos(rad(p.lat)) * Math.cos(rad(lat)) * Math.sin(rad(lng - p.lng) / 2) ** 2;
		const km = 2 * 6371 * Math.asin(Math.sqrt(a));
		return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
	}

	// Server datetimes are in the system time zone, which is also the rep's.
	function parse_datetime(value) {
		return new Date(String(value).replace(" ", "T").split(".")[0]);
	}

	function time_of(value) {
		return parse_datetime(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	}

	function show_tab(tab) {
		state.tab = tab;
		window.scrollTo({ top: 0, behavior: "smooth" });
		document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
		["home", "routes", "checkins", "profile"].forEach((name) => $(`panel-${name}`).classList.toggle("hidden", name !== tab));
		// Leaflet measures its box when drawn; a map drawn while hidden needs a nudge.
		if (tab === "home" && state.map) setTimeout(() => state.map.invalidateSize(), 0);
	}

	async function load() {
		state.day = await api(`${FIELD_API}.get_field_day`);
		state.loaded_at = Date.now();
		render();
	}

	async function refresh() {
		try {
			await load();
			toast("Up to date.", "success", 1500);
		} catch (error) {
			toast(error.message, "error", 7000);
		}
	}

	// A manager may change the route while the page is open; the bell and the stops follow without a refresh.
	async function check_notifications() {
		if (!state.day || document.visibilityState !== "visible" || !$("sheet").classList.contains("hidden")) return;
		const notifications = await api(`${FIELD_API}.get_notifications`);
		const known = new Set((state.day.notifications || []).map((n) => n.name));
		const fresh = notifications.filter((n) => !known.has(n.name) && !n.read);
		if (fresh.some((n) => n.document_type === "Beat Plan")) await load();
		else {
			state.day.notifications = notifications; // new ones, or some were read on Desk
			render();
		}
		if (fresh.length) toast(fresh[0].subject, "", 6000);
	}

	// ---------- start ----------

	document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => show_tab(t.dataset.tab)));
	$("avatar").onclick = () => show_tab("profile");
	$("bell").onclick = open_updates;
	$("see-all").onclick = () => show_tab("routes");
	$("btn-checkin").onclick = () => {
		const next = next_stop(state.day);
		if (next) start_check_in(next.customer, next.customer_name || next.customer, next.beat_plan);
	};
	$("btn-checkout").onclick = start_check_out;
	// Back on the page (phone unlocked, app switched back): pick up a newly assigned route or a manager's review.
	document.addEventListener("visibilitychange", () => {
		const stale = !state.loaded_at || Date.now() - state.loaded_at > RELOAD_AFTER_MS;
		if (document.visibilityState === "visible" && stale && $("sheet").classList.contains("hidden")) load().catch(() => {});
	});
	// Braces matter: an onclick handler that returns false cancels the click, which stopped the photo input from opening.
	$("sheet").onclick = (e) => {
		if (e.target.id === "sheet") close_sheet();
	};
	setInterval(() => check_notifications().catch(() => {}), NOTIFY_POLL_MS);
	run("Loading…", load)
		.then(locate_quietly)
		.catch(() => {});
})();
