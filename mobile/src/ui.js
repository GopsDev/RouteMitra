// Small building blocks shared by the screens.

import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './icons';
import { colors, shadow, tones } from './theme';
import { stopInfo } from './day';
import { fileSource } from './api';

export function Button({ title, icon, onPress, kind = 'plain', large, disabled, busy, style }) {
  const look = buttonLooks[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        look.box,
        large && styles.buttonLarge,
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={look.text} /> : icon ? <Icon name={icon} size={large ? 22 : 18} color={look.text} width={2.4} /> : null}
      <Text style={[styles.buttonText, large && styles.buttonTextLarge, { color: look.text }]}>{title}</Text>
    </Pressable>
  );
}

const buttonLooks = {
  plain: { box: { backgroundColor: colors.card, borderColor: colors.border }, text: colors.text },
  primary: { box: { backgroundColor: colors.primary, borderColor: colors.primary }, text: '#ffffff' },
  outline: { box: { backgroundColor: colors.card, borderColor: colors.text, borderWidth: 2 }, text: colors.text },
  green: { box: { backgroundColor: colors.greenDot, borderColor: colors.greenDot }, text: '#ffffff' },
  soft: { box: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft }, text: colors.primaryDark },
};

export function Pill({ tone = '', text }) {
  const [bg, fg] = tones[tone] || tones[''];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

// A bottom sheet: dims the screen and slides a card up from the bottom.
export function Sheet({ visible, title, onClose, children }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.sheetBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheetCard, { paddingBottom: 20 + insets.bottom }]}>
          <View style={styles.sheetHandle} />
          {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function StopRow({ stop, day, position, onPress, flat }) {
  const info = stopInfo(stop, day, position);
  const name = stop.customer_name || stop.customer;
  const showLabel = info.kind === 'done' || info.kind === 'active';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.stopRow, !flat && styles.card, pressed && onPress && styles.pressed]}>
      {stop.image ? <ShopPhoto url={stop.image} badge={<StopIcon stop={stop} kind={info.kind} small />} /> : <StopIcon stop={stop} kind={info.kind} />}
      <View style={styles.stopText}>
        <Text style={styles.stopTitle}>
          <Text style={styles.bold}>{name}</Text>
          {showLabel ? <Text style={styles.muted}>{` — ${info.label}`}</Text> : null}
        </Text>
        <Text style={styles.stopSub}>{info.sub}</Text>
      </View>
      <Pill tone={info.chip[0]} text={info.chip[1]} />
    </Pressable>
  );
}

// A shop's picture as a rounded thumbnail, with an optional status badge on its corner.
export function ShopPhoto({ url, size = 52, badge }) {
  return (
    <View style={{ width: size, height: size }}>
      <Image source={fileSource(url)} style={[styles.photo, { width: size, height: size }]} contentFit="cover" transition={150} />
      {badge ? <View style={styles.photoBadge}>{badge}</View> : null}
    </View>
  );
}

export function StopIcon({ stop, kind, small }) {
  if (small) {
    // The badge on a shop photo: just the colour and a tick or number.
    const look = {
      done: [colors.greenDot, <Icon key="i" name="check" size={11} color="#fff" width={3.2} />],
      active: [colors.primary, <Icon key="i" name="pin" size={11} color="#fff" width={2.6} />],
      next: [colors.primary, <Text key="i" style={styles.badgeText}>{stop.idx}</Text>],
      skipped: [colors.orangeDot, <Text key="i" style={styles.badgeText}>!</Text>],
      missed: [colors.redDot, <Icon key="i" name="close" size={11} color="#fff" width={3.2} />],
      planned: ['#64748b', <Text key="i" style={styles.badgeText}>{stop.idx}</Text>],
    }[kind];
    return <View style={[styles.badge, { backgroundColor: look[0] }]}>{look[1]}</View>;
  }
  if (kind === 'done') return <View style={[styles.stopIcon, { backgroundColor: colors.greenDot }]}><Icon name="check" size={18} color="#fff" width={3} /></View>;
  if (kind === 'active') return <View style={styles.stopIcon}><Icon name="pin" size={30} color={colors.primary} width={2.4} /></View>;
  if (kind === 'skipped') return <View style={[styles.stopIcon, { backgroundColor: colors.orangeBg }]}><Icon name="skip" size={16} color={colors.orange} /></View>;
  if (kind === 'missed') return <View style={[styles.stopIcon, { backgroundColor: colors.redBg }]}><Icon name="close" size={16} color={colors.red} /></View>;
  if (kind === 'next') return <View style={[styles.stopIcon, { backgroundColor: colors.primarySoft }]}><Text style={styles.stopNumber}>{stop.idx}</Text></View>;
  return <View style={[styles.stopIcon, { backgroundColor: colors.gray }]} />;
}

export function Empty({ icon, title, text }) {
  return (
    <View style={[styles.card, styles.empty]}>
      <View style={styles.emptyIcon}><Icon name={icon} size={24} color={colors.primary} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function SectionHead({ title, right }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.h2}>{title}</Text>
      {right}
    </View>
  );
}

export const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonLarge: { minHeight: 58, borderRadius: 16 },
  buttonText: { fontSize: 15, fontWeight: '700' },
  buttonTextLarge: { fontSize: 19 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  pill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, maxWidth: 150 },
  pillText: { fontSize: 13, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: 18, ...shadow },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(8, 15, 22, 0.5)' },
  sheetCard: { maxHeight: '92%', backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10, paddingHorizontal: 18 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 12 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 6 },
  sheetBody: { gap: 14, paddingBottom: 4 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, paddingLeft: 16 },
  stopIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  photo: { borderRadius: 14, backgroundColor: colors.grayBg },
  photoBadge: { position: 'absolute', right: -4, bottom: -4 },
  badge: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  stopNumber: { color: colors.primaryDark, fontWeight: '800', fontSize: 14 },
  stopText: { flex: 1, gap: 2 },
  stopTitle: { fontSize: 16, color: colors.text },
  stopSub: { fontSize: 14, color: colors.muted },
  bold: { fontWeight: '800' },
  muted: { color: colors.muted },
  empty: { alignItems: 'center', padding: 28, gap: 4 },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  h2: { fontSize: 22, fontWeight: '800', color: colors.text },
  sub: { fontSize: 14, color: colors.muted },
});
