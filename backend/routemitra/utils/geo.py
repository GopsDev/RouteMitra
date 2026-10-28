# Copyright (c) 2026, Gopal and contributors
# For license information, please see license.txt

"""Distance maths and address-to-coordinates lookups (OpenStreetMap or Google)."""

import json
import math
import time
import urllib.parse
import urllib.request

EARTH_RADIUS_M = 6371000
USER_AGENT = "routemitra/0.1 (+https://github.com/frappe/erpnext; Frappe app)"
NOMINATIM_MIN_INTERVAL = 1.1  # the public server allows 1 request per second
_last_nominatim_call = [0.0]
# Places this big are a worse guess for a shop than its PIN code's centre.
COARSE_PLACE_KINDS = {
	"city", "county", "district", "state_district", "state", "region", "country",
	"administrative_area_level_1", "administrative_area_level_2",
}


class GeocodingError(Exception):
	"""The provider could not be reached or rejected the request."""


def distance_m(lat1, lng1, lat2, lng2):
	"""Great-circle (haversine) distance in metres between two points."""
	phi1, phi2 = math.radians(lat1), math.radians(lat2)
	d_phi = math.radians(lat2 - lat1)
	d_lambda = math.radians(lng2 - lng1)
	a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
	return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def geocode(
	query, provider="OpenStreetMap", google_api_key=None, nominatim_url=None, country_code=None, near=None, max_km=None,
	skip_coarse=False,
):
	"""
	Look up coordinates for a free-text address.

	Parameters:
	        query (str, required): e.g. "12 Main Road, Vadasery, Nagercoil 629001, India".
	        provider (str, optional): "OpenStreetMap" (default) or "Google".
	        google_api_key (str, optional): Required for Google.
	        nominatim_url (str, optional): Base URL of a Nominatim server.
	        country_code (str, optional): ISO 3166-1 alpha-2 code to restrict results (e.g. "in").
	        near (tuple, optional): (lat, lng) the answer must be close to, usually the
	                PIN code's centre. Place names repeat across districts ("Kalkulam"
	                exists in Kanniyakumari and Chengalpattu), so free text alone is not enough.
	        max_km (float, optional): With `near`, reject results farther than this.
	        skip_coarse (bool, optional): Ignore whole cities, districts and states
	                (COARSE_PLACE_KINDS): a "Mumbai" match is Mumbai's centre, kilometres off.

	Returns:
	        tuple or None: (latitude, longitude, display name) or None when nothing matched.

	Raises:
	        GeocodingError: network failure, bad key, or quota exceeded.
	"""
	if provider == "Google":
		candidates = _google(query, google_api_key, country_code)
	else:
		candidates = _nominatim(nominatim_url, country_code, q=query)
	if skip_coarse:
		candidates = [c for c in candidates if c[4] not in COARSE_PLACE_KINDS]
	return _pick(candidates, near, max_km)


def locate_postcode(postcode, provider="OpenStreetMap", google_api_key=None, nominatim_url=None, country_code=None):
	"""
	Centre of a PIN / postal code, and the district it belongs to.

	Returns:
	        tuple or None: (latitude, longitude, display name, district or "")
	"""
	if provider == "Google":
		candidates = _google(postcode, google_api_key, country_code, postal=True)
	else:
		candidates = _nominatim(nominatim_url, country_code, postalcode=postcode)
	return candidates[0] if candidates else None


def _pick(candidates, near, max_km):
	"""First candidate, or with `near` the closest one within `max_km`."""
	if not candidates:
		return None
	if not near:
		return candidates[0][:3]
	scored = [(distance_m(*near, c[0], c[1]), c) for c in candidates]
	scored = [(metres, c) for metres, c in scored if max_km is None or metres <= max_km * 1000]
	return min(scored, key=lambda item: item[0])[1][:3] if scored else None


def _nominatim(base_url, country_code, **search):
	"""Up to 5 candidates as (lat, lng, display name, district, place kind)."""
	base_url = base_url or "https://nominatim.openstreetmap.org"
	wait = NOMINATIM_MIN_INTERVAL - (time.monotonic() - _last_nominatim_call[0])
	if wait > 0:
		time.sleep(wait)
	params = {**search, "format": "jsonv2", "limit": 5, "addressdetails": 1}
	if country_code:
		params["countrycodes"] = country_code.lower()
	try:
		results = _get_json(f"{base_url.rstrip('/')}/search?{urllib.parse.urlencode(params)}")
	finally:
		_last_nominatim_call[0] = time.monotonic()
	candidates = []
	for row in results or []:
		address = row.get("address") or {}
		district = address.get("state_district") or address.get("county") or ""
		kind = row.get("addresstype") or row.get("type") or ""
		candidates.append((float(row["lat"]), float(row["lon"]), row.get("display_name", ""), district, kind))
	return candidates


def _google(query, api_key, country_code, postal=False):
	"""Candidates as (lat, lng, formatted address, district, place kind)."""
	if not api_key:
		raise GeocodingError("Set the Google Maps API Key in RouteMitra Settings.")
	components = [f"country:{country_code.upper()}"] if country_code else []
	params = {"key": api_key}
	if postal:
		components.append(f"postal_code:{query}")
	else:
		params["address"] = query
	if components:
		params["components"] = "|".join(components)
	payload = _get_json(f"https://maps.googleapis.com/maps/api/geocode/json?{urllib.parse.urlencode(params)}")
	status = payload.get("status")
	if status == "ZERO_RESULTS":
		return []
	if status != "OK":
		raise GeocodingError(f"Google geocoding failed: {status} {payload.get('error_message', '')}".strip())
	candidates = []
	for result in payload["results"]:
		location = result["geometry"]["location"]
		district = next(
			(c["long_name"] for c in result.get("address_components", []) if "administrative_area_level_3" in c["types"]
			 or "administrative_area_level_2" in c["types"]),
			"",
		)
		kind = next(iter(result.get("types") or []), "")
		candidates.append((float(location["lat"]), float(location["lng"]), result.get("formatted_address", ""), district, kind))
	return candidates


def _get_json(url):
	request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
	try:
		with urllib.request.urlopen(request, timeout=20) as response:
			return json.loads(response.read())
	except Exception as error:
		raise GeocodingError(f"Geocoding request failed: {error}") from error


def order_stops(points, start=None):
	"""
	Visiting order that keeps the total straight-line distance short:
	nearest-neighbour to build a route, then 2-opt to remove crossings.
	Good for a salesperson's 5-40 stops; not a full vehicle-routing solver.

	Parameters:
	        points (list, required): [(lat, lng), ...] for each stop.
	        start (tuple, optional): (lat, lng) where the day starts.

	Returns:
	        list: Indices of `points` in visiting order.
	"""
	if len(points) < 3 and not start:
		return list(range(len(points)))

	remaining = list(range(len(points)))
	route = []
	current = start or points[remaining.pop(0)]
	if not start:
		route.append(0)
	while remaining:
		nearest = min(remaining, key=lambda i: distance_m(*current, *points[i]))
		remaining.remove(nearest)
		route.append(nearest)
		current = points[nearest]
	return _two_opt(route, points, start)


def route_length_m(route, points, start=None):
	"""Total length of visiting `points` in `route` order, from `start` if given."""
	coords = ([start] if start else []) + [points[i] for i in route]
	return sum(distance_m(*coords[i], *coords[i + 1]) for i in range(len(coords) - 1))


def _two_opt(route, points, start):
	best = route[:]
	improved = True
	while improved:
		improved = False
		for i in range(0 if start else 1, len(best) - 1):
			for j in range(i + 1, len(best)):
				candidate = best[:i] + best[i : j + 1][::-1] + best[j + 1 :]
				if route_length_m(candidate, points, start) + 1e-6 < route_length_m(best, points, start):
					best, improved = candidate, True
	return best
