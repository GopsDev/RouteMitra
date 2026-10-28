// RouteMitra mobile app: the field sales rep's companion for ERPNext.

import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { loadSession, setLoggedOutHandler } from './src/api';
import { colors } from './src/theme';
import Login from './src/screens/Login';
import FieldApp from './src/FieldApp';

export default function App() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    loadSession().then(setSession);
    // Logged in on another phone, or the token was reset: back to the login screen.
    setLoggedOutHandler(() => setSession((s) => ({ ...s, token: '' })));
  }, []);

  let screen;
  if (!session) {
    screen = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (!session.token) {
    screen = <Login savedServer={session.server} onLoggedIn={() => loadSession().then(setSession)} />;
  } else {
    screen = <FieldApp server={session.server} onLoggedOut={() => setSession({ ...session, token: '' })} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {screen}
    </SafeAreaProvider>
  );
}
