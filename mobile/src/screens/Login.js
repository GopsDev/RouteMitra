// Login with the rep's ERPNext email and password.

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { devServer, login } from '../api';
import { colors } from '../theme';
import { Button } from '../ui';
import Logo from '../Logo';

export default function Login({ savedServer, onLoggedIn }) {
  const insets = useSafeAreaInsets();
  const [server, setServer] = useState(savedServer || devServer());
  const [usr, setUsr] = useState('');
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!server.trim() || !usr.trim() || !pwd) return setError('Fill in the server, email and password.');
    setBusy(true);
    setError('');
    try {
      await login(server, usr, pwd);
      onLoggedIn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Logo size={44} />
          <Text style={styles.brandName}>RouteMitra</Text>
        </View>
        <Text style={styles.tagline}>{"Today's route, GPS check-in and shop visits for field sales."}</Text>

        <View style={styles.form}>
          <Field label="Server" value={server} onChangeText={setServer} placeholder="erp.yourcompany.com" keyboardType="url" />
          <Field label="Email" value={usr} onChangeText={setUsr} placeholder="you@company.com" keyboardType="email-address" />
          <Field label="Password" value={pwd} onChangeText={setPwd} placeholder="Your ERPNext password" secureTextEntry onSubmitEditing={submit} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button kind="primary" large title="Log In" busy={busy} onPress={submit} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.gray} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.card },
  body: { paddingHorizontal: 24, gap: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandName: { fontSize: 32, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  tagline: { fontSize: 15, color: colors.muted, marginBottom: 20 },
  form: { gap: 16 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text },
  input: {
    height: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: 16,
  },
  error: { padding: 12, borderRadius: 12, backgroundColor: colors.redBg, color: colors.red, fontWeight: '600' },
});
