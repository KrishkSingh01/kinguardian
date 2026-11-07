import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { apiRequest, logout } from "./api/client";
import type { MobileSession, User } from "./api/models";
import { clearSession, readSession, saveSession } from "./auth/sessionStore";
import { ActionButton } from "./components/ActionButton";
import { AuthScreen } from "./screens/AuthScreen";
import { AlertsScreen, HomeScreen, JourneysScreen, PeopleScreen, SettingsScreen } from "./screens/MainScreens";
import { MapScreen } from "./screens/MapScreen";
import { colors } from "./theme/colors";

type TabName = "Home" | "People" | "Journeys" | "Map" | "Alerts" | "Settings";
type Tabs = Record<TabName, undefined>;
const Tab = createBottomTabNavigator<Tabs>();

export default function App() {
  const [session, setSession] = useState<MobileSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [offline, setOffline] = useState(false);
  const [startupNotice, setStartupNotice] = useState("");

  useEffect(() => NetInfo.addEventListener((state) => {
    setOffline(state.isConnected === false || state.isInternetReachable === false);
  }), []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      let stored: MobileSession | null;
      try {
        stored = await readSession();
      } catch {
        // A device may reject an old or unavailable secure-storage entry. Keep
        // the app usable by returning to sign-in instead of leaving startup
        // as an unhandled promise rejection.
        if (mounted) {
          setStartupNotice("Your saved sign-in could not be opened. Please sign in again.");
          setLoaded(true);
        }
        return;
      }
      if (!stored) { if (mounted) setLoaded(true); return; }
      try {
        const result = await apiRequest<{ user: User }>("/api/auth/me");
        const refreshed = { ...stored, user: result.user };
        await saveSession(refreshed);
        if (mounted) { setSession(refreshed); setMustChangePassword(result.user.mustChangePassword); }
      } catch (error) {
        if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 401) {
          await clearSession();
        } else {
          // Keep a valid locally saved session visible when the network is unavailable.
          if (mounted) { setSession(stored); setMustChangePassword(stored.user.mustChangePassword); }
        }
      } finally { if (mounted) setLoaded(true); }
    })();
    return () => { mounted = false; };
  }, []);

  async function signOut() {
    try { await logout(); } finally { setSession(null); setMustChangePassword(false); }
  }
  return <SafeAreaProvider>
    <StatusBar style="light" />
    <View style={styles.appShell}>
      {offline ? <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.offlineBanner}>
        <Text style={styles.offlineText}>Offline · SOS and changes cannot reach your trusted people until you reconnect.</Text>
      </View> : null}
      <View style={styles.appContent}>
        {!loaded ? <LoadingScreen /> : !session ? <>
          {startupNotice ? <View accessibilityRole="alert" style={styles.startupNotice}><Text style={styles.startupNoticeText}>{startupNotice}</Text></View> : null}
          <AuthScreen onSignedIn={(next) => { setSession(next); setMustChangePassword(next.user.mustChangePassword); }} />
        </>
          : mustChangePassword ? <PasswordChangeScreen user={session.user} onChanged={(user) => {
            const next = { ...session, user: { ...session.user, ...user, mustChangePassword: false } };
            setSession(next); setMustChangePassword(false); void saveSession(next);
          }} onSignOut={() => { void signOut(); }} />
          : <NavigationContainer theme={{ ...DefaultTheme, dark: true, colors: {
              ...DefaultTheme.colors, background: colors.background, card: colors.surface, text: colors.text,
              border: colors.border, primary: colors.green, notification: colors.red,
            } }}>
              <Tab.Navigator initialRouteName="Home" screenOptions={({ route }) => ({
                headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text,
                headerTitleStyle: { fontWeight: "700" }, tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64, paddingTop: 6, paddingBottom: 6 },
                tabBarActiveTintColor: colors.green, tabBarInactiveTintColor: colors.muted,
                tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
                tabBarIcon: ({ color }) => <Text style={{ fontSize: 17, color }}>{({ Home: "⌂", People: "♡", Journeys: "◷", Map: "⌖", Alerts: "◇", Settings: "⚙" } as Record<string, string>)[route.name]}</Text>,
              })}>
                <Tab.Screen name="Home" options={{ title: "KinGuardian" }}>{() => <HomeScreen user={session.user} onSignOut={() => { void signOut(); }} />}</Tab.Screen>
                <Tab.Screen name="People" component={PeopleScreen} />
                <Tab.Screen name="Journeys" component={JourneysScreen} />
                <Tab.Screen name="Map" component={MapScreen} />
                <Tab.Screen name="Alerts" component={AlertsScreen} />
                <Tab.Screen name="Settings" options={{ title: "Settings" }}>{() => <SettingsScreen user={session.user} onSignOut={() => { void signOut(); }} />}</Tab.Screen>
              </Tab.Navigator>
          </NavigationContainer>}
      </View>
    </View>
  </SafeAreaProvider>;
}

function LoadingScreen() {
  return <View style={styles.loading}><ActivityIndicator size="large" color={colors.green} /><Text style={styles.loadingText}>Opening KinGuardian…</Text></View>;
}

function PasswordChangeScreen({ user, onChanged, onSignOut }: { user: User; onChanged: (user: User) => void; onSignOut: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ mustChangePassword: boolean }>("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      if (!result.mustChangePassword) onChanged({ ...user, mustChangePassword: false });
    } catch (error) { setMessage(error instanceof Error ? error.message : "The password could not be changed."); }
    finally { setBusy(false); }
  }
  return <View style={styles.passwordPage}>
    <View style={styles.passwordCard}><Text style={styles.eyebrow}>ONE REQUIRED STEP</Text><Text style={styles.title}>Choose your own password.</Text>
      <Text style={styles.loadingText}>For your account's safety, the temporary password must be replaced before continuing.</Text>
      <Text style={styles.label}>Current password</Text><TextInput accessibilityLabel="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoCapitalize="none" style={styles.input} />
      <Text style={styles.label}>New password (at least 12 characters)</Text><TextInput accessibilityLabel="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" style={styles.input} />
      {message ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{message}</Text> : null}
      <ActionButton label="Change password" busy={busy} onPress={() => { void submit(); }} />
      <Text style={styles.signout} onPress={onSignOut}>Sign out</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  appShell: { flex: 1, backgroundColor: colors.background },
  appContent: { flex: 1 },
  offlineBanner: { backgroundColor: colors.amber, paddingVertical: 9, paddingHorizontal: 14 },
  offlineText: { color: "#1a201c", fontSize: 13, fontWeight: "700", textAlign: "center" },
  startupNotice: { backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: 1, padding: 12 },
  startupNoticeText: { color: colors.text, textAlign: "center", lineHeight: 20 },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: 14 },
  loadingText: { color: colors.muted, lineHeight: 21 },
  passwordPage: { flex: 1, justifyContent: "center", backgroundColor: colors.background, padding: 20 },
  passwordCard: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 22, padding: 22, gap: 12 },
  eyebrow: { color: colors.green, fontSize: 11, fontWeight: "700", letterSpacing: 1.1 },
  title: { color: colors.text, fontWeight: "800", fontSize: 26 },
  label: { color: colors.text, fontWeight: "600", fontSize: 13 },
  input: { minHeight: 48, color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 13 },
  error: { color: colors.red },
  signout: { color: colors.green, textAlign: "center", padding: 8 },
});
