// Home: map, the big Check-In / Check-Out buttons, the beat plan and the fraud checks.

import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View, Pressable } from 'react-native';

import Icon from '../icons';
import RouteMap from '../RouteMap';
import { colors } from '../theme';
import { Button, Empty, Pill, SectionHead, StopRow, styles as ui } from '../ui';
import { allStops, nextStop, parseDatetime, routeUrl } from '../day';

const HOME_STOPS = 4; // the Routes tab has all of them

export default function Home({ day, position, onStopPress, onCheckIn, onCheckOut, onSeeAll }) {
  const stops = allStops(day);
  const next = nextStop(day);
  const finished = stops.filter((s) => s.status !== 'Planned').length;
  const date = parseDatetime(`${day.today} 00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  let status = ['teal', 'Field Rep · Active'];
  if (day.open_visit) status = ['green', 'On a visit'];
  else if (!day.sales_person) status = ['orange', 'Not linked'];

  let hint = '';
  if (day.open_visit) hint = `Check out of ${day.open_visit.customer_name} before the next shop.`;
  else if (next) hint = `Next: ${next.customer_name || next.customer}`;
  else if (stops.length) hint = "All stops on today's route are done.";

  // The last finished stop and the next few planned ones.
  const shown = [];
  for (let i = stops.length - 1; i >= 0; i--) {
    if (stops[i].status !== 'Planned') {
      shown.push(stops[i]);
      break;
    }
  }
  for (const stop of stops) {
    if (stop.status === 'Planned' && shown.length < HOME_STOPS) shown.push(stop);
  }
  shown.sort((a, b) => stops.indexOf(a) - stops.indexOf(b));

  return (
    <View style={styles.page}>
      {!day.sales_person ? (
        <Text style={styles.notice}>{"Your login isn't linked to a Sales Person, so you have no route. Ask your manager to link your Employee record to a Sales Person."}</Text>
      ) : null}
      {day.settings.test_location ? <Text style={styles.notice}>Test location is on (developer mode): GPS is simulated.</Text> : null}

      <View style={styles.datebar}>
        <Text style={styles.dateText}>{`Today · ${date}`}</Text>
        <Pill tone={status[0]} text={status[1]} />
      </View>

      <RouteMap day={day} position={position} onStopPress={onStopPress} />
      {routeUrl(day) ? (
        <Pressable onPress={() => Linking.openURL(routeUrl(day))} style={styles.mapLink}>
          <Text style={styles.seeAllText}>Open route in Google Maps</Text>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        <Button kind="primary" large icon="crosshair" title="Check-In" style={styles.flex} disabled={!!day.open_visit || !next} onPress={() => onCheckIn(next)} />
        <Button kind="outline" large title="Check-Out" style={styles.flex} disabled={!day.open_visit} onPress={onCheckOut} />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {day.open_visit ? <OpenVisit visit={day.open_visit} /> : null}

      <SectionHead title="Sales Beat Plan" right={stops.length ? <Pill tone="green" text={`${finished}/${stops.length} Completed`} /> : null} />
      {stops.length ? (
        <View style={styles.list}>
          {shown.map((stop) => (
            <StopRow key={`${stop.beat_plan}-${stop.idx}`} stop={stop} day={day} position={position} onPress={() => onStopPress(stop)} />
          ))}
        </View>
      ) : (
        <Empty icon="route" title="No route planned today" text="Your manager plans your Beat Plan. Pull down to refresh once it's ready." />
      )}
      {stops.length > shown.length ? (
        <Pressable onPress={onSeeAll} style={styles.seeAll}>
          <Text style={styles.seeAllText}>{`View full route (${stops.length} stops)`}</Text>
        </Pressable>
      ) : null}

      <FraudChecks day={day} position={position} />
    </View>
  );
}

function OpenVisit({ visit }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - parseDatetime(visit.checkin_time).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  const clock = h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  return (
    <View style={styles.open}>
      <View style={styles.flex}>
        <View style={styles.openLabelRow}>
          <View style={styles.liveDot} />
          <Text style={styles.openLabel}>AT THE SHOP NOW</Text>
        </View>
        <Text style={styles.openName}>{visit.customer_name}</Text>
        <Text style={styles.openSub}>{`${visit.is_suspicious ? 'Flagged' : visit.status}${visit.distance_m != null ? ` · ${visit.distance_m} m from the pin` : ''}`}</Text>
      </View>
      <Text style={styles.timer}>{clock}</Text>
    </View>
  );
}

// What the server checks on every visit, shown so the rep knows visits are verified.
function FraudChecks({ day, position }) {
  const visits = day.visits;
  const flagged = visits.filter((v) => v.is_suspicious).length;
  const inside = visits.filter((v) => v.status === 'Verified').length;
  const lines = [];
  if (visits.length) lines.push([inside === visits.length, `GPS: ${inside} of ${visits.length} visits inside the shop radius`]);
  else lines.push([true, `GPS: check in within ${day.settings.checkin_radius} m of the shop`]);
  lines.push([true, day.settings.require_photo ? 'Photos: live camera only, no gallery' : 'Photos: not required']);
  if (position) lines.push([!position.mocked, position.mocked ? 'Fake GPS app detected on this phone' : 'Fake GPS: not detected']);
  if (position) lines.push([position.accuracy <= 50, `Location accuracy: ±${Math.round(position.accuracy)} m`]);
  if (flagged) lines.push([false, `${flagged} visit${flagged > 1 ? 's' : ''} flagged for your manager`]);
  const warn = flagged || (position && position.mocked);
  return (
    <View style={styles.checks}>
      <View style={styles.checksHead}>
        <Icon name="shield" size={32} color={colors.primaryDark} />
        <Text style={styles.checksTitle}>Fraud Detection</Text>
        <Pill tone={warn ? 'red' : 'green'} text={warn ? 'Review' : 'Secure'} />
      </View>
      {lines.map(([ok, text]) => (
        <View key={text} style={styles.checkLine}>
          <Icon name={ok ? 'check' : 'flag'} size={16} color={ok ? colors.text : colors.red} width={2.6} />
          <Text style={[styles.checkText, !ok && { color: colors.red, fontWeight: '700' }]}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  flex: { flex: 1 },
  notice: { padding: 12, borderRadius: 14, backgroundColor: colors.orangeBg, color: colors.orange, fontWeight: '600', fontSize: 14 },
  datebar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 10,
    borderRadius: 16,
    backgroundColor: colors.grayBg,
  },
  dateText: { fontSize: 15, color: colors.muted, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 12 },
  hint: { ...ui.sub, marginTop: -4 },
  list: { gap: 10 },
  seeAll: { alignSelf: 'center', padding: 10 },
  mapLink: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 4, marginTop: -8 },
  seeAllText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  open: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, backgroundColor: colors.primary },
  openLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#7ef0b0' },
  openLabel: { color: '#ffffff', fontSize: 12, fontWeight: '800', letterSpacing: 0.8, opacity: 0.9 },
  openName: { color: '#ffffff', fontSize: 17, fontWeight: '800', marginTop: 2 },
  openSub: { color: '#ffffff', fontSize: 13, opacity: 0.9 },
  timer: { color: '#ffffff', fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  checks: { marginTop: 4, padding: 16, paddingBottom: 18, borderRadius: 20, backgroundColor: colors.checksBg, gap: 6 },
  checksHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  checksTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.text },
  checkLine: { flexDirection: 'row', gap: 8, paddingLeft: 44, alignItems: 'flex-start' },
  checkText: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '500' },
});
