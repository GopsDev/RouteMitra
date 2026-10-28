// Today's route on a map: numbered pins, a line joining them in order, and "You".
// Drawn with Leaflet and OpenStreetMap inside a WebView, the same map as the web page,
// so it needs no Google Maps API key in Expo Go or in a release build.

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import Icon from './icons';
import { colors, shadow } from './theme';
import { allStops, routeKm, stopInfo } from './day';

const PIN_COLOR = {
  done: colors.greenDot,
  active: colors.primary,
  next: colors.primary,
  planned: '#64748b',
  skipped: colors.orangeDot,
  missed: colors.redDot,
};

export default function RouteMap({ day, position, onStopPress }) {
  const web = useRef(null);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState('');
  const stops = allStops(day);
  const located = stops.filter((s) => s.latitude && s.longitude);
  const km = routeKm(day);

  // What the page draws: one entry per located stop, plus the rep's position.
  const pins = located.map((stop) => {
    const info = stopInfo(stop, day, position);
    return {
      lat: stop.latitude,
      lng: stop.longitude,
      color: PIN_COLOR[info.kind],
      label: info.kind === 'done' ? '✓' : info.kind === 'skipped' ? '!' : String(stop.idx),
      name: stop.customer_name || stop.customer,
      showName: info.kind === 'next' || info.kind === 'active',
      ring: info.kind === 'active',
    };
  });
  const data = JSON.stringify({ pins, you: position ? [position.lat, position.lng] : null, line: colors.route });

  useEffect(() => {
    if (ready && web.current) web.current.injectJavaScript(`draw(${data}); true;`);
  }, [ready, data]);

  // The page says "ready" once Leaflet has loaded; no word in 10 seconds means it couldn't.
  useEffect(() => {
    const timer = setTimeout(() => setProblem((p) => p || (ready ? '' : 'waiting')), 10000);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!pins.length && !position) {
    return (
      <View style={[styles.card, styles.empty]}>
        <Text style={styles.emptyText}>{stops.length ? 'Your shops have no map location yet.' : 'No route planned today.'}</Text>
      </View>
    );
  }

  // Messages from the page: "ready", "tap:<index>", "tiles-failed" or "error:<text>".
  function onMessage(event) {
    const message = String(event.nativeEvent.data);
    if (message === 'ready') {
      setReady(true);
      setProblem('');
    } else if (message.startsWith('tap:')) {
      const stop = located[Number(message.slice(4))];
      if (stop) onStopPress(stop);
    } else if (message === 'tiles-failed') {
      setProblem("Map tiles didn't load. Check that the phone has internet.");
    } else if (message.startsWith('error:')) {
      setProblem(`Map error: ${message.slice(6)}`);
    }
  }

  let notice = problem;
  if (problem === 'waiting') notice = "The map couldn't load. Check that the phone has internet.";

  return (
    <View style={styles.card}>
      <WebView
        ref={web}
        originWhitelist={['*']}
        // A real https origin, so the OpenStreetMap tile servers see a referrer.
        source={{ html: PAGE, baseUrl: 'https://routemitra.local/' }}
        onMessage={onMessage}
        onError={(event) => setProblem(`Map error: ${event.nativeEvent.description}`)}
        scrollEnabled={false}
        nestedScrollEnabled
        // Android can draw a WebView blank inside a rounded, clipped box; this opacity avoids it.
        style={[styles.web, { opacity: 0.99 }]}
      />
      {notice ? (
        <View style={styles.notice} pointerEvents="none">
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}
      <View style={styles.chip} pointerEvents="none">
        <Icon name="route" size={16} color={colors.text} />
        <Text style={styles.chipText}>{`${km ? `${km.toFixed(1)} km · ` : ''}${stops.length} stops`}</Text>
      </View>
    </View>
  );
}

const PAGE = `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
  html, body, #map { margin: 0; height: 100%; background: #eceff3; font-family: -apple-system, Roboto, sans-serif; }
  .leaflet-control-attribution { font-size: 9px; }
  .leaflet-control-zoom { border: none !important; box-shadow: 0 2px 8px rgba(0,0,0,.15) !important; }
  .pin { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
    border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,.3); color: #fff; font: 800 12px sans-serif; box-sizing: border-box; }
  .pin span { transform: rotate(45deg); }
  .ring { box-shadow: 0 0 0 6px rgba(14,124,128,.25); }
  .you { width: 18px; height: 18px; border-radius: 50%; background: #2563eb; border: 3px solid #fff;
    box-shadow: 0 0 0 8px rgba(37,99,235,.2); box-sizing: border-box; }
  .label { padding: 3px 8px; border: none; border-radius: 8px; background: #fff; color: #0f1d2e;
    font: 700 12px sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,.18); }
  .label::before { display: none; }
</style>
</head><body><div id="map"></div>
<script>
  function send(message) { window.ReactNativeWebView.postMessage(message); }
  window.onerror = function (message) { send('error:' + message); };
  if (!window.L) send('error:Leaflet did not load');
  var map = L.map('map', { zoomControl: false });
  var tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  var loaded = 0, failed = 0;
  tiles.on('tileload', function () { loaded++; });
  tiles.on('tileerror', function () { failed++; if (failed === 4 && !loaded) send('tiles-failed'); });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  var layer = L.layerGroup().addTo(map);

  function draw(data) {
    layer.clearLayers();
    var points = data.pins.map(function (p) { return [p.lat, p.lng]; });
    if (points.length > 1) L.polyline(points, { color: data.line, weight: 5, opacity: 0.85 }).addTo(layer);
    data.pins.forEach(function (p, i) {
      var html = '<div class="pin' + (p.ring ? ' ring' : '') + '" style="background:' + p.color + '"><span>' + p.label + '</span></div>';
      var marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: html, iconSize: [30, 30], iconAnchor: [15, 30] }),
        zIndexOffset: p.showName ? 1000 : 0
      }).addTo(layer);
      if (p.showName) {
        marker.bindTooltip(p.name.replace(/</g, '&lt;'), { permanent: true, direction: 'right', offset: [12, -16], className: 'label' });
      }
      marker.on('click', function () { send('tap:' + i); });
    });
    if (data.you) {
      L.marker(data.you, { icon: L.divIcon({ className: '', html: '<div class="you"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) })
        .bindTooltip('You', { permanent: true, direction: 'bottom', offset: [0, 10], className: 'label' })
        .addTo(layer);
      points.push(data.you);
    }
    if (points.length === 1) map.setView(points[0], 15);
    else if (points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
  }
  send('ready');
</script>
</body></html>`;

const styles = StyleSheet.create({
  card: { height: 260, borderRadius: 20, overflow: 'hidden', backgroundColor: colors.grayBg, ...shadow },
  web: { flex: 1, backgroundColor: colors.grayBg },
  notice: { position: 'absolute', left: 12, right: 12, bottom: 12, padding: 10, borderRadius: 12, backgroundColor: colors.orangeBg },
  noticeText: { color: colors.orange, fontWeight: '700', fontSize: 13 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: colors.muted, fontWeight: '600', textAlign: 'center' },
  chip: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: colors.card,
    ...shadow,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
});
