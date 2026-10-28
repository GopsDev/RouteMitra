// The logged-in app: header, the four tabs, and every check-in / check-out action.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { call, FIELD_API, MAPS_API, logout } from './api';
import { getPosition, initials } from './day';
import Icon from './icons';
import Logo from './Logo';
import { colors } from './theme';
import { CameraSheet, CheckOutSheet, SkipSheet, StopSheet, UpdatesSheet } from './sheets';
import Home from './screens/Home';
import Routes from './screens/Routes';
import Checkins from './screens/Checkins';
import Profile from './screens/Profile';

const RELOAD_AFTER_MS = 60 * 1000; // coming back to the app after this long fetches the day again
const NOTIFY_POLL_MS = 30 * 1000; // while the app is open, check this often for a manager's changes
const TABS = [
  ['home', 'Home', 'home'],
  ['routes', 'Routes', 'route'],
  ['checkins', 'Check-ins', 'checkins'],
  ['profile', 'Profile', 'profile'],
];

export default function FieldApp({ server, onLoggedOut }) {
  const insets = useSafeAreaInsets();
  const [day, setDay] = useState(null);
  const [position, setPosition] = useState(null);
  const [tab, setTab] = useState('home');
  const [sheet, setSheet] = useState(null); // {type: 'stop' | 'camera' | 'checkout' | 'skip' | 'updates', stop}
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const loadedAt = useRef(0);
  const scroll = useRef(null);
  const toastTimer = useRef(null);

  function showToast(text, kind = '', ms = 4000) {
    clearTimeout(toastTimer.current);
    setToast({ text, kind });
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }

  const load = useCallback(async () => {
    const result = await call(`${FIELD_API}.get_field_day`);
    loadedAt.current = Date.now();
    setDay(result);
    setLoadError('');
    return result;
  }, []);

  // Shows "You" on the map and distances on the stops. Quiet: errors only matter at check-in.
  async function locateQuietly(current) {
    try {
      setPosition(await getPosition(current));
    } catch {
      // The rep sees the real error when they check in.
    }
  }

  // First load. load() only sets state after the server answers, so this isn't a synchronous update.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
      .then(locateQuietly)
      .catch((error) => setLoadError(error.message));
  }, [load]);

  // Back in the app: pick up a newly assigned route or a manager's review.
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - loadedAt.current > RELOAD_AFTER_MS && !sheet) load().catch(() => {});
    });
    return () => listener.remove();
  }, [sheet, load]);

  // A manager may change the route while the app is open; the bell and the stops follow without a pull-to-refresh.
  // One steady timer: it reads the latest day and sheet from refs, so re-renders don't restart it.
  const latest = useRef({ day: null, sheet: null });
  latest.current = { day, sheet };
  useEffect(() => {
    const timer = setInterval(async () => {
      const { day: current, sheet: open } = latest.current;
      if (!current || open || AppState.currentState !== 'active') return; // don't reload under an open sheet
      try {
        const notifications = await call(`${FIELD_API}.get_notifications`);
        const known = (current.notifications || []).map((n) => n.name);
        const fresh = notifications.filter((n) => !known.includes(n.name) && !n.read);
        const unreadBefore = (current.notifications || []).filter((n) => !n.read).length;
        const unreadNow = notifications.filter((n) => !n.read).length;
        if (fresh.some((n) => n.document_type === 'Beat Plan')) await load();
        else if (fresh.length || unreadNow !== unreadBefore) {
          setDay((now) => ({ ...now, notifications })); // new ones, or some were read on Desk
        }
        if (fresh.length) showToast(fresh[0].subject, '', 6000);
      } catch {
        // Try again next time; a bad signal shouldn't nag the rep.
      }
    }, NOTIFY_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      const current = await load();
      await locateQuietly(current);
    } catch (error) {
      showToast(error.message, 'error', 7000);
    } finally {
      setRefreshing(false);
    }
  }

  async function run(text, fn) {
    setBusy(text);
    try {
      return await fn();
    } catch (error) {
      showToast(error.message, 'error', 7000);
      throw error;
    } finally {
      setBusy('');
    }
  }

  function showTab(name) {
    setTab(name);
    if (scroll.current) scroll.current.scrollTo({ y: 0, animated: false });
  }

  // ---------- check in / out ----------

  function startCheckIn(stop) {
    if (!stop) return;
    if (day.open_visit) return showToast(`Check out of ${day.open_visit.customer_name} first.`, 'error');
    if (day.settings.require_photo) setSheet({ type: 'camera', stop });
    else confirmCheckIn(stop, null).catch(() => {});
  }

  async function confirmCheckIn(stop, photo) {
    setSheet(null);
    const result = await run('Getting your GPS position…', async () => {
      const pos = await getPosition(day);
      setPosition(pos);
      setBusy('Checking in…');
      return call(`${MAPS_API}.check_in`, {
        customer: stop.customer,
        beat_plan: stop.beat_plan,
        photo,
        photo_source: photo ? 'camera' : null,
        latitude: pos.lat,
        longitude: pos.lng,
        accuracy_m: pos.accuracy,
        is_mocked: pos.mocked ? 1 : 0,
      });
    });
    const note = result.is_suspicious ? ' Flagged for your manager to review.' : '';
    const kind = result.is_suspicious ? 'error' : result.status === 'Verified' ? 'success' : '';
    showToast(`Checked in: ${result.status}, ${result.distance_m} m from the shop.${note}`, kind, 7000);
    await load();
    showTab('home');
  }

  async function checkOut({ outcome, notes }) {
    if (!outcome) return showToast('Choose what happened at the shop before checking out.', 'error');
    const visit = day.open_visit;
    setSheet(null);
    const result = await run('Saving…', async () => {
      await call(`${FIELD_API}.save_visit_outcome`, { sales_visit: visit.name, outcome, notes });
      setBusy('Getting your GPS position…');
      const pos = await getPosition(day);
      setPosition(pos);
      setBusy('Checking out…');
      return call(`${MAPS_API}.check_out`, {
        sales_visit: visit.name,
        latitude: pos.lat,
        longitude: pos.lng,
        accuracy_m: pos.accuracy,
        is_mocked: pos.mocked ? 1 : 0,
      });
    });
    const note = result.is_suspicious ? ' Flagged for your manager to review.' : '';
    showToast(`Checked out after ${result.duration_minutes} min.${note}`, result.is_suspicious ? 'error' : 'success', 7000);
    await load();
  }

  async function saveOutcome({ outcome, notes }) {
    setSheet(null);
    await run('Saving…', () => call(`${FIELD_API}.save_visit_outcome`, { sales_visit: day.open_visit.name, outcome, notes }));
    showToast('Saved.', 'success');
    await load();
  }

  async function skip(stop, { reason, note }) {
    setSheet(null);
    await run('Saving…', () => call(`${FIELD_API}.skip_stop`, { beat_plan: stop.beat_plan, customer: stop.customer, reason, note }));
    showToast(`${stop.customer_name || stop.customer} skipped: ${reason}.`, '', 5000);
    await load();
  }

  // Read updates stay in the list, faded; only the bell dot goes.
  async function markUpdatesRead(names) {
    try {
      await call(`${FIELD_API}.mark_notifications_read`, names ? { names } : {});
      const notifications = day.notifications.map((n) => (!names || names.includes(n.name) ? { ...n, read: 1 } : n));
      setDay({ ...day, notifications });
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function logOut() {
    await run('Logging out…', logout);
    onLoggedOut();
  }

  // Errors are already shown as a toast by run().
  const quiet = (promise) => promise.catch(() => {});

  // ---------- screens ----------

  if (!day) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        {loadError ? (
          <View style={{ gap: 14, padding: 24, alignItems: 'center' }}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable onPress={() => { setLoadError(''); load().then(locateQuietly).catch((e) => setLoadError(e.message)); }}>
              <Text style={styles.link}>Try again</Text>
            </Pressable>
            <Pressable onPress={logOut}><Text style={styles.link}>Log out</Text></Pressable>
          </View>
        ) : (
          <ActivityIndicator size="large" color={colors.primary} />
        )}
      </View>
    );
  }

  const openStop = (stop) => setSheet({ type: 'stop', stop });
  const hasUpdates = (day.notifications || []).some((n) => !n.read);

  let page;
  if (tab === 'home') {
    page = <Home day={day} position={position} onStopPress={openStop} onCheckIn={startCheckIn} onCheckOut={() => setSheet({ type: 'checkout' })} onSeeAll={() => showTab('routes')} />;
  } else if (tab === 'routes') {
    page = <Routes day={day} position={position} onStopPress={openStop} onCheckIn={startCheckIn} onSkip={(stop) => setSheet({ type: 'skip', stop })} />;
  } else if (tab === 'checkins') {
    page = <Checkins day={day} />;
  } else {
    page = <Profile day={day} server={server} onUpdates={() => setSheet({ type: 'updates' })} onRefresh={refresh} onLogout={logOut} />;
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.topbar, { paddingTop: insets.top + 10 }]}>
        <View style={styles.brand}>
          <Logo size={30} />
          <Text style={styles.brandName}>RouteMitra</Text>
        </View>
        <View style={styles.topActions}>
          <Pressable style={styles.avatar} onPress={() => showTab('profile')} accessibilityLabel="Your profile">
            <Text style={styles.avatarText}>{initials(day.user_name)}</Text>
          </Pressable>
          <Pressable style={styles.bell} onPress={() => setSheet({ type: 'updates' })} accessibilityLabel="Updates">
            <Icon name="bell" size={26} />
            {hasUpdates ? <View style={styles.bellDot} /> : null}
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        {page}
      </ScrollView>

      <View style={[styles.tabbar, { paddingBottom: insets.bottom, height: 68 + insets.bottom }]}>
        {TABS.map(([name, label, icon]) => {
          const active = tab === name;
          const color = active ? colors.primary : colors.muted;
          return (
            <Pressable key={name} style={styles.tab} onPress={() => showTab(name)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Icon name={icon} size={26} color={color} width={active ? 2.4 : 2} />
              <Text style={[styles.tabText, { color }]}>{label}</Text>
              {name === 'checkins' && day.visits.length ? (
                <View style={styles.badge}><Text style={styles.badgeText}>{day.visits.length}</Text></View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {toast ? (
        <View style={[styles.toast, { bottom: 84 + insets.bottom }, toast.kind === 'success' && styles.toastSuccess, toast.kind === 'error' && styles.toastError]}>
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      ) : null}

      {sheet && sheet.type === 'stop' ? (
        <StopSheet
          stop={sheet.stop}
          day={day}
          position={position}
          onClose={() => setSheet(null)}
          onCheckIn={() => startCheckIn(sheet.stop)}
          onSkip={() => setSheet({ type: 'skip', stop: sheet.stop })}
          onCheckOut={() => setSheet({ type: 'checkout' })}
        />
      ) : null}
      {sheet && sheet.type === 'camera' ? (
        <CameraSheet stop={sheet.stop} onClose={() => setSheet(null)} onConfirm={(photo) => quiet(confirmCheckIn(sheet.stop, photo))} />
      ) : null}
      {sheet && sheet.type === 'checkout' && day.open_visit ? (
        <CheckOutSheet day={day} onClose={() => setSheet(null)} onSave={(form) => quiet(saveOutcome(form))} onCheckOut={(form) => quiet(checkOut(form))} />
      ) : null}
      {sheet && sheet.type === 'skip' ? (
        <SkipSheet stop={sheet.stop} day={day} onClose={() => setSheet(null)} onSkip={(form) => quiet(skip(sheet.stop, form))} />
      ) : null}
      {sheet && sheet.type === 'updates' ? (
        <UpdatesSheet items={day.notifications || []} onClose={() => setSheet(null)} onMarkRead={markUpdatesRead} />
      ) : null}

      {busy ? (
        <View style={styles.busy}>
          <View style={styles.busyCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.busyText}>{busy}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  errorText: { color: colors.red, fontWeight: '600', textAlign: 'center', fontSize: 15 },
  link: { color: colors.primary, fontWeight: '700', fontSize: 15, padding: 8 },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandName: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  bellDot: { position: 'absolute', top: 8, right: 9, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.redDot, borderWidth: 2, borderColor: colors.card },
  content: { padding: 16, paddingBottom: 32 },
  tabbar: { flexDirection: 'row', backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabText: { fontSize: 13, fontWeight: '600' },
  badge: { position: 'absolute', top: 6, left: '56%', minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  toast: { position: 'absolute', left: 16, right: 16, padding: 14, borderRadius: 14, backgroundColor: colors.text },
  toastSuccess: { backgroundColor: colors.green },
  toastError: { backgroundColor: colors.red },
  toastText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8, 15, 22, 0.35)', alignItems: 'center', justifyContent: 'center' },
  busyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 20, borderRadius: 16, backgroundColor: colors.card },
  busyText: { fontWeight: '700', color: colors.text },
});
