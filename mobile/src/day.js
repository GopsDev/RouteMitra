// Helpers for the day returned by field.get_field_day: stops, their look, times and distances.

import * as Location from 'expo-location';

export function allStops(day) {
  if (!day) return [];
  return day.plans.flatMap((plan) => plan.stops.map((stop) => ({ ...stop, beat_plan: plan.name })));
}

export function nextStop(day) {
  return allStops(day).find((s) => s.status === 'Planned');
}

export function routeKm(day) {
  return day.plans.reduce((sum, p) => sum + (p.total_distance_km || 0), 0);
}

// How a stop looks: its kind (icon and colour), a label, a sub line and a chip [tone, text].
export function stopInfo(stop, day, position) {
  const visit = day.visits.find((v) => v.name === stop.sales_visit || (!stop.sales_visit && v.customer === stop.customer));
  const open = day.open_visit;
  if (open && open.customer === stop.customer && stop.status !== 'Skipped') {
    return { kind: 'active', label: 'Active', sub: `Checked in ${timeOf(open.checkin_time)} · In progress`, chip: ['orange', 'In progress'] };
  }
  if (stop.status === 'Visited') {
    let sub = 'Visited';
    if (visit) sub = `Checked in ${timeOf(visit.checkin_time)}${visit.duration_minutes ? ` · ${visit.duration_minutes} min` : ''}`;
    let chip = ['green', 'Done'];
    if (visit && visit.order_total) chip = ['teal', `Order: ${money(visit.order_total, visit.order_currency)}`];
    else if (visit && visit.is_suspicious) chip = ['red', 'Flagged'];
    else if (visit && visit.outcome) chip = ['teal', visit.outcome];
    return { kind: 'done', label: 'Completed', sub, chip };
  }
  if (stop.status === 'Skipped') return { kind: 'skipped', label: 'Skipped', sub: stop.skip_reason || 'Skipped', chip: ['orange', 'Skipped'] };
  if (stop.status === 'Missed') return { kind: 'missed', label: 'Missed', sub: stop.address || 'Not visited', chip: ['red', 'Missed'] };

  const next = nextStop(day);
  const isNext = next && next.customer === stop.customer && next.beat_plan === stop.beat_plan;
  const away = stop.latitude && stop.longitude && position ? ` · ${distanceText(position, stop.latitude, stop.longitude)} away` : '';
  return {
    kind: isNext ? 'next' : 'planned',
    label: isNext ? 'Next' : 'Upcoming',
    sub: `${stop.address || 'No address'}${away}`,
    chip: isNext ? ['teal', 'Next'] : ['', `Stop ${stop.idx}`],
  };
}

// The phone's position. In developer mode the server can send a fixed test location instead.
export async function getPosition(day) {
  const test = day && day.settings.test_location;
  if (test) return { lat: test.lat, lng: test.lng, accuracy: 10, mocked: false };
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new Error('Location permission is off. Allow location for RouteMitra in the phone settings.');
  }
  const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
  return {
    lat: fix.coords.latitude,
    lng: fix.coords.longitude,
    accuracy: fix.coords.accuracy || 0,
    // Android tells us when a fake-GPS app supplied the position; the server flags the visit.
    mocked: !!fix.mocked,
  };
}

export function distanceText(position, lat, lng) {
  const rad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat - position.lat) / 2) ** 2 +
    Math.cos(rad(position.lat)) * Math.cos(rad(lat)) * Math.sin(rad(lng - position.lng) / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.sqrt(a));
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// Server datetimes are in the system time zone, which is also the rep's.
export function parseDatetime(value) {
  return new Date(String(value).replace(' ', 'T').split('.')[0]);
}

export function timeOf(value) {
  return parseDatetime(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function ago(value) {
  const minutes = Math.max(0, Math.round((Date.now() - parseDatetime(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return parseDatetime(value).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function money(amount, currency) {
  try {
    return new Intl.NumberFormat([], { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency || ''} ${Math.round(amount)}`.trim();
  }
}

export function initials(name) {
  const words = String(name || '?').trim().split(/\s+/);
  return (words[0][0] + (words.length > 1 ? words[1][0] : '')).toUpperCase();
}

export function directionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

// The stops still to visit, in order, as one Google Maps route from where the rep is now.
// Google Maps links take up to 9 waypoints plus the destination; the rest are left for later.
export function routeUrl(day) {
  const left = allStops(day).filter((s) => s.status === 'Planned' && s.latitude && s.longitude).slice(0, 10);
  if (!left.length) return null;
  const last = left[left.length - 1];
  let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${last.latitude},${last.longitude}`;
  const waypoints = left.slice(0, -1).map((s) => `${s.latitude},${s.longitude}`);
  if (waypoints.length) url += `&waypoints=${encodeURIComponent(waypoints.join('|'))}`;
  return url;
}
