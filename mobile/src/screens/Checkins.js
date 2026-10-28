// Check-ins: today's visits with a small summary.

import { StyleSheet, Text, View } from 'react-native';

import Icon from '../icons';
import { colors } from '../theme';
import { Empty, Pill, SectionHead, ShopPhoto, styles as ui } from '../ui';
import { money, timeOf } from '../day';

export default function Checkins({ day }) {
  const visits = day.visits;
  if (!visits.length) {
    return <Empty icon="check" title="No check-ins yet today" text="Your visits show up here after you check in." />;
  }
  const minutes = visits.reduce((sum, v) => sum + (v.duration_minutes || 0), 0);
  const flagged = visits.filter((v) => v.is_suspicious).length;
  return (
    <View style={styles.page}>
      <SectionHead title="Check-ins" right={<Text style={ui.sub}>{`${visits.length} today`}</Text>} />
      <View style={styles.summary}>
        <Tile value={visits.length} label="Visits" />
        <Tile value={`${minutes}m`} label="In shops" />
        <Tile value={flagged} label="Flagged" red={flagged > 0} />
      </View>
      {visits.map((v) => {
        let tone = '';
        if (v.is_suspicious) tone = 'red';
        else if (v.status === 'Verified') tone = 'green';
        else if (v.status === 'Outside Radius') tone = 'orange';
        const when = `${timeOf(v.checkin_time)}${v.checkout_time ? ` – ${timeOf(v.checkout_time)} · ${v.duration_minutes} min` : ' · still open'}`;
        let extra = '';
        if (v.order_total) extra = ` · Order ${money(v.order_total, v.order_currency)}`;
        else if (v.outcome) extra = ` · ${v.outcome}`;
        return (
          <View key={v.name} style={[ui.card, ui.stopRow]}>
            {v.photo ? <ShopPhoto url={v.photo} badge={<VisitIcon visit={v} small />} /> : <VisitIcon visit={v} />}
            <View style={ui.stopText}>
              <Text style={[ui.stopTitle, ui.bold]}>{v.customer_name}</Text>
              <Text style={ui.stopSub}>{when + extra}</Text>
            </View>
            <Pill tone={tone} text={v.is_suspicious ? 'Flagged' : v.status} />
          </View>
        );
      })}
    </View>
  );
}

function Tile({ value, label, red }) {
  return (
    <View style={[ui.card, styles.tile]}>
      <Text style={[styles.tileValue, red && { color: colors.red }]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function VisitIcon({ visit, small }) {
  if (small) {
    let color = colors.greenDot;
    let icon = 'check';
    if (visit.is_suspicious) [color, icon] = [colors.redDot, 'flag'];
    else if (!visit.checkout_time) [color, icon] = [colors.primary, 'pin'];
    return <View style={[ui.badge, { backgroundColor: color }]}><Icon name={icon} size={11} color="#fff" width={3} /></View>;
  }
  if (visit.is_suspicious) return <View style={[ui.stopIcon, { backgroundColor: colors.redBg }]}><Icon name="flag" size={16} color={colors.red} /></View>;
  if (!visit.checkout_time) return <View style={ui.stopIcon}><Icon name="pin" size={30} color={colors.primary} width={2.4} /></View>;
  return <View style={[ui.stopIcon, { backgroundColor: colors.greenDot }]}><Icon name="check" size={18} color="#fff" width={3} /></View>;
}

const styles = StyleSheet.create({
  page: { gap: 10 },
  summary: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, padding: 14, gap: 2 },
  tileValue: { fontSize: 24, fontWeight: '800', color: colors.text },
  tileLabel: { fontSize: 13, fontWeight: '600', color: colors.muted },
});
