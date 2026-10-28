// Routes: every stop on today's route, with Navigate, Check In and Skip.

import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';
import { Button, Empty, SectionHead, StopRow, styles as ui } from '../ui';
import { allStops, directionsUrl, nextStop, routeKm, routeUrl } from '../day';

export default function Routes({ day, position, onStopPress, onCheckIn, onSkip }) {
  const stops = allStops(day);
  if (!stops.length) {
    return <Empty icon="route" title="No route planned today" text="Your Beat Plan shows up here once your manager plans it." />;
  }
  const km = routeKm(day);
  const next = nextStop(day);
  const fullRoute = routeUrl(day);
  return (
    <View style={styles.page}>
      <SectionHead title="Today's route" right={<Text style={ui.sub}>{`${stops.length} stops${km ? ` · ${km.toFixed(1)} km` : ''}`}</Text>} />
      {fullRoute ? <Button kind="soft" icon="navigate" title="Open route in Google Maps" onPress={() => Linking.openURL(fullRoute)} /> : null}
      {stops.map((stop) => {
        const isNext = next && next.customer === stop.customer && next.beat_plan === stop.beat_plan;
        const located = stop.latitude && stop.longitude;
        return (
          <View key={`${stop.beat_plan}-${stop.idx}`} style={[ui.card, styles.card, isNext && styles.next]}>
            <StopRow flat stop={stop} day={day} position={position} onPress={() => onStopPress(stop)} />
            {stop.status === 'Planned' ? (
              <View style={styles.actions}>
                <View style={styles.row}>
                  {located ? (
                    <Button kind="soft" icon="navigate" title="Navigate" style={styles.flex} onPress={() => Linking.openURL(directionsUrl(stop.latitude, stop.longitude))} />
                  ) : null}
                  <Button kind="primary" icon="pin" title="Check In" style={styles.flex} disabled={!!day.open_visit} onPress={() => onCheckIn(stop)} />
                </View>
                <Pressable onPress={() => onSkip(stop)} style={styles.skip}>
                  <Text style={styles.skipText}>{"Can't visit? Skip"}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 10 },
  card: { overflow: 'hidden' },
  next: { borderWidth: 2, borderColor: colors.primary },
  actions: { paddingHorizontal: 14, paddingBottom: 6 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  skip: { alignSelf: 'center', padding: 10 },
  skipText: { color: colors.muted, fontWeight: '700', fontSize: 14 },
});
