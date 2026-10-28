# RouteMitra mobile app

Field sales app for ERPNext. Reps see today's Beat Plan on a map, check in at shops with GPS and a live camera photo, check out with the visit outcome, and skip shops they can't reach.

It talks to the `routemitra` Frappe app (v16) on the ERPNext server:

| What | Endpoint |
| --- | --- |
| Login / logout (token) | `routemitra.routemitra_core.api.v1.auth.login`, `.logout` |
| Today's route, visits, updates | `routemitra.routemitra_core.api.v1.field.get_field_day` |
| Outcome, skip, mark updates read | `field.save_visit_outcome`, `field.skip_stop`, `field.mark_notifications_read` |
| Check in / check out | `routemitra.routemitra_core.api.v1.maps.check_in`, `.check_out` |

Login returns `api_key:api_secret`; every call sends `Authorization: token <api_key>:<api_secret>`. Logging in on a new phone logs the old one out.

On Android the app sends `is_mocked` when the position comes from a fake-GPS app, and the server flags the visit.

## Run on a phone (Expo Go)

1. Install **Expo Go** from the Play Store / App Store.
2. Put the phone and this computer on the same Wi-Fi.
3. `npm install`, then `npx expo start`, and scan the QR code with Expo Go.
4. In the app, log in with the server address (for a local bench: `http://<computer's LAN IP>:8000`) and a user that has the **Sales User** role and is linked to a Sales Person.

## Release build

`npx eas-cli@latest build -p android --profile preview` gives an installable APK. Use an `https://` server for real use.

The map is Leaflet with OpenStreetMap tiles inside a WebView, so no Google Maps API key is needed. Navigate and "Open route in Google Maps" open the phone's Google Maps app.
