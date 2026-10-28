// Profile: who is logged in, updates, refresh and log out.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from '../icons';
import { colors } from '../theme';
import { styles as ui } from '../ui';
import { initials } from '../day';

export default function Profile({ day, server, onUpdates, onRefresh, onLogout }) {
  const count = (day.notifications || []).filter((n) => !n.read).length;
  return (
    <View style={styles.page}>
      <View style={[ui.card, styles.card]}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(day.user_name)}</Text></View>
        <Text style={styles.name}>{day.user_name}</Text>
        <Text style={ui.sub}>{day.sales_person || 'No Sales Person linked'}</Text>
        <Text style={ui.sub}>{day.user}</Text>
        <Text style={[ui.sub, { marginTop: 6 }]}>{server}</Text>
      </View>
      <View style={[ui.card, styles.menu]}>
        <MenuItem icon="bell" title={`Updates${count ? ` (${count})` : ''}`} onPress={onUpdates} />
        <MenuItem icon="refresh" title="Refresh" onPress={onRefresh} />
        <MenuItem icon="logout" title="Log out" danger onPress={onLogout} last />
      </View>
    </View>
  );
}

function MenuItem({ icon, title, onPress, danger, last }) {
  const color = danger ? colors.red : colors.text;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.item, !last && styles.itemLine, pressed && ui.pressed]}>
      <Icon name={icon} color={danger ? colors.red : colors.muted} />
      <Text style={[styles.itemText, { color }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  card: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16, gap: 4 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  avatarText: { color: '#ffffff', fontSize: 28, fontWeight: '800' },
  name: { fontSize: 20, fontWeight: '800', color: colors.text },
  menu: { overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingHorizontal: 16 },
  itemLine: { borderBottomWidth: 1, borderBottomColor: colors.border },
  itemText: { fontSize: 16, fontWeight: '600' },
});
