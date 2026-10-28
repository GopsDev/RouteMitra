// The pop-ups: a stop's details, the check-in camera, check-out, skip and updates.

import { useRef, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './icons';
import { colors } from './theme';
import { Button, Empty, Sheet, styles as ui } from './ui';
import { ago, directionsUrl, distanceText, stopInfo, timeOf } from './day';
import { fileSource, stripHtml } from './api';

const PHOTO_MAX_PX = 1280; // photos are shrunk on the phone before upload

export function StopSheet({ stop, day, position, onClose, onCheckIn, onSkip, onCheckOut }) {
  if (!stop) return null;
  const info = stopInfo(stop, day, position);
  const located = stop.latitude && stop.longitude;
  const canAct = stop.status === 'Planned' && !day.open_visit;
  const away = located && position ? ` · ${distanceText(position, stop.latitude, stop.longitude)} away` : '';
  return (
    <Sheet visible title={stop.customer_name || stop.customer} onClose={onClose}>
      {stop.image ? <Image source={fileSource(stop.image)} style={sheet.shopPhoto} contentFit="cover" transition={150} /> : null}
      <View style={{ gap: 4 }}>
        <Text style={ui.sub}>{stop.address || 'No address'}</Text>
        <Text style={ui.sub}>{`Stop ${stop.idx} · ${info.label}${away}`}</Text>
      </View>
      {info.kind === 'active' ? <Button kind="green" icon="logout" title="Check Out" onPress={onCheckOut} /> : null}
      {stop.status === 'Planned' ? (
        <>
          <View style={sheet.row}>
            {located ? (
              <Button kind="soft" icon="navigate" title="Navigate" style={sheet.flex} onPress={() => Linking.openURL(directionsUrl(stop.latitude, stop.longitude))} />
            ) : null}
            <Button kind="primary" icon="pin" title="Check In" style={sheet.flex} disabled={!canAct} onPress={onCheckIn} />
          </View>
          <Pressable onPress={onSkip} style={sheet.link}>
            <Text style={sheet.linkText}>{"Can't visit? Skip"}</Text>
          </Pressable>
        </>
      ) : null}
    </Sheet>
  );
}

// Shop photos come only from the live camera, never the gallery, so an old photo
// can't be passed off as today's visit.
export function CameraSheet({ stop, onClose, onConfirm }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState(null);
  const [taking, setTaking] = useState(false);
  const camera = useRef(null);
  const insets = useSafeAreaInsets();
  const name = stop.customer_name || stop.customer;

  async function capture() {
    if (!camera.current) return;
    setTaking(true);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.9 });
      const context = ImageManipulator.manipulate(shot.uri);
      if (shot.width >= shot.height) context.resize({ width: Math.min(shot.width, PHOTO_MAX_PX), height: null });
      else context.resize({ width: null, height: Math.min(shot.height, PHOTO_MAX_PX) });
      const image = await context.renderAsync();
      const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
      setPhoto({ uri: result.uri, data: `data:image/jpeg;base64,${result.base64}` });
    } finally {
      setTaking(false);
    }
  }

  let body;
  if (!permission) {
    body = <View style={sheet.cameraBox} />;
  } else if (!permission.granted) {
    body = (
      <View style={[sheet.cameraBox, sheet.center, { padding: 24, gap: 14 }]}>
        <Text style={sheet.cameraText}>RouteMitra needs the camera to photograph the shop front.</Text>
        <Button kind="primary" title="Allow Camera" onPress={requestPermission} />
      </View>
    );
  } else if (photo) {
    body = <Image source={{ uri: photo.uri }} style={sheet.cameraBox} contentFit="cover" />;
  } else {
    body = (
      <View style={sheet.cameraBox}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
        <Pressable onPress={capture} disabled={taking} accessibilityLabel="Take photo" style={[sheet.shutter, taking && ui.disabled]} />
      </View>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[sheet.cameraScreen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
        <Text style={sheet.cameraLabel}>CHECK IN · STOP {stop.idx}</Text>
        <Text style={sheet.cameraTitle}>{name}</Text>
        <Text style={sheet.cameraHint}>Take a photo of the shop front. It is saved with the visit.</Text>
        {body}
        <View style={sheet.row}>
          <Button title="Cancel" style={sheet.flex} onPress={onClose} />
          {photo ? <Button title="Retake" icon="camera" style={sheet.flex} onPress={() => setPhoto(null)} /> : null}
          <Button kind="primary" icon="pin" title="Check In" style={sheet.flex} disabled={!photo} onPress={() => onConfirm(photo.data)} />
        </View>
      </View>
    </Modal>
  );
}

export function CheckOutSheet({ day, onClose, onSave, onCheckOut }) {
  const visit = day.open_visit;
  const [outcome, setOutcome] = useState(visit.outcome || '');
  const [notes, setNotes] = useState(visit.notes || '');
  const minimum = day.settings.min_visit_minutes ? ` · stay at least ${day.settings.min_visit_minutes} min` : '';
  return (
    <Sheet visible title={`Check out of ${visit.customer_name}`} onClose={onClose}>
      <Text style={ui.sub}>{`Checked in at ${timeOf(visit.checkin_time)}${minimum}`}</Text>
      <Text style={sheet.label}>What happened?</Text>
      <Choices options={day.outcomes} value={outcome} onChange={setOutcome} />
      <Text style={sheet.label}>Notes</Text>
      <TextInput
        style={sheet.textarea}
        multiline
        value={notes}
        onChangeText={setNotes}
        placeholder="Order details, follow-up, anything useful"
        placeholderTextColor={colors.gray}
      />
      <View style={sheet.row}>
        <Button title="Save" style={sheet.flex} onPress={() => onSave({ outcome, notes })} />
        <Button kind="green" icon="logout" title="Check Out" style={sheet.flex} onPress={() => onCheckOut({ outcome, notes })} />
      </View>
    </Sheet>
  );
}

// The rep can't make it to a shop on today's route: say why, so the manager knows.
export function SkipSheet({ stop, day, onClose, onSkip }) {
  const [reason, setReason] = useState(day.skip_reasons[0]);
  const [note, setNote] = useState('');
  return (
    <Sheet visible title={`Skip ${stop.customer_name || stop.customer}?`} onClose={onClose}>
      <Text style={ui.sub}>Your manager sees this reason.</Text>
      <Choices options={day.skip_reasons} value={reason} onChange={setReason} />
      <Text style={sheet.label}>Note (optional)</Text>
      <TextInput
        style={sheet.textarea}
        multiline
        value={note}
        onChangeText={setNote}
        placeholder="Anything your manager should know"
        placeholderTextColor={colors.gray}
      />
      <View style={sheet.row}>
        <Button title="Cancel" style={sheet.flex} onPress={onClose} />
        <Button kind="primary" title="Skip Shop" style={sheet.flex} onPress={() => onSkip({ reason, note })} />
      </View>
    </Sheet>
  );
}

// Notifications for the rep: new route, visit approved/rejected.
// Last week's updates. Read ones stay, faded; the tick marks one read.
export function UpdatesSheet({ items, onClose, onMarkRead }) {
  const unread = items.filter((n) => !n.read).length;
  return (
    <Sheet visible title="Updates" onClose={onClose}>
      {!items.length ? (
        <Empty icon="bell" title="No updates this week" text="New routes and visit reviews show up here." />
      ) : (
        <>
          {items.map((n) => (
            <View key={n.name} style={[sheet.update, n.read && sheet.updateRead]}>
              <View style={sheet.flex}>
                <Text style={[sheet.updateText, n.read && sheet.updateTextRead]}>{stripHtml(n.subject)}</Text>
                <Text style={ui.sub}>{ago(n.creation)}</Text>
              </View>
              {n.read ? null : (
                <Pressable onPress={() => onMarkRead([n.name])} style={sheet.updateClose} accessibilityLabel="Mark read">
                  <Icon name="check" size={16} color={colors.muted} />
                </Pressable>
              )}
            </View>
          ))}
          {unread ? <Button title="Mark all read" onPress={() => onMarkRead(null)} /> : null}
        </>
      )}
    </Sheet>
  );
}

function Choices({ options, value, onChange }) {
  return (
    <View style={sheet.choices}>
      {options.map((option) => {
        const picked = option === value;
        return (
          <Pressable key={option} onPress={() => onChange(option)} style={[sheet.choice, picked && sheet.choicePicked]}>
            <Text style={[sheet.choiceText, picked && { color: '#ffffff' }]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const sheet = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  link: { alignSelf: 'center', padding: 8 },
  linkText: { color: colors.muted, fontWeight: '700', fontSize: 14 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: -6 },
  textarea: {
    minHeight: 90,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderWidth: 2, borderColor: colors.border, borderRadius: 14 },
  choicePicked: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { fontSize: 14, fontWeight: '700', color: colors.text },
  update: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  updateText: { fontSize: 15, fontWeight: '600', color: colors.text },
  updateRead: { opacity: 0.6 },
  updateTextRead: { fontWeight: '400' },
  updateClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.grayBg, alignItems: 'center', justifyContent: 'center' },
  shopPhoto: { width: '100%', height: 180, borderRadius: 16, backgroundColor: colors.grayBg },
  cameraScreen: { flex: 1, backgroundColor: '#0a1320', paddingHorizontal: 16, gap: 12 },
  cameraLabel: { color: colors.orangeDot, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  cameraTitle: { color: '#ffffff', fontSize: 22, fontWeight: '800', marginTop: -6 },
  cameraHint: { color: '#a9b4c4', fontSize: 14 },
  cameraBox: { flex: 1, borderRadius: 20, overflow: 'hidden', backgroundColor: '#1c2a3d' },
  cameraText: { color: '#ffffff', fontSize: 15, textAlign: 'center' },
  shutter: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 5,
    borderColor: '#ffffff',
    backgroundColor: colors.primary,
  },
});
