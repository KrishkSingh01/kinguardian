import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { ApiError, apiRequest, logout } from "../api/client";
import type { NotificationEvent, SafeJourney, SosAlert, TrustedConnection, User } from "../api/models";
import { ActionButton } from "../components/ActionButton";
import { colors } from "../theme/colors";
import { deleteQueuedSos, readQueuedSos, saveQueuedSos, type QueuedSos } from "../storage/secureQueue";
import { requestNativeNotificationPermission, scheduleLocalNotificationTest } from "../notifications/nativeNotifications";

type Props = { user: User; onSignOut: () => void };
type RequestSummary = { connectionId: string; username: string; createdAt?: number };
type ConnectionsResult = {
  connections: TrustedConnection[];
  requests: RequestSummary[];
  sentRequests: RequestSummary[];
  recentReplies?: (RequestSummary & { status: "accepted" | "rejected"; answeredAt?: number })[];
};

function Page({ title, hint, children, refreshing = false, onRefresh }: { title: string; hint?: string; children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled"
    refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} colors={[colors.green]} /> : undefined}>
    <Text style={styles.pageTitle}>{title}</Text>{hint ? <Text style={styles.hint}>{hint}</Text> : null}{children}
  </ScrollView>;
}

function Card({ children }: { children: React.ReactNode }) { return <View style={styles.card}>{children}</View>; }
function Notice({ children, danger = false }: { children: string; danger?: boolean }) { return <Text accessibilityLiveRegion="polite" style={[styles.notice, danger && styles.danger]}>{children}</Text>; }
function Field({ label, value, onChangeText, secure = false, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; secure?: boolean; placeholder?: string }) {
  return <View style={styles.fieldWrap}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} placeholder={placeholder} placeholderTextColor={colors.muted} style={styles.input} /></View>;
}

export function HomeScreen({ user, onOpenSettings }: { user: User; onOpenSettings: () => void }) {
  const [connections, setConnections] = useState<TrustedConnection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [includeLocation, setIncludeLocation] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [queued, setQueued] = useState<QueuedSos[]>([]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = await apiRequest<ConnectionsResult>("/api/connections");
      setConnections(result.connections.filter((item) => item.status === "accepted" && item.receiveSos));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load trusted people."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadQueued = useCallback(async () => {
    try { setQueued(await readQueuedSos(user.userId)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Encrypted offline storage is unavailable."); }
  }, [user.userId]);
  useEffect(() => { void loadQueued(); }, [loadQueued]);

  const sendAlert = useCallback(async (testMode: boolean, existingDraft?: QueuedSos) => {
    if (!testMode && selected.length === 0) {
      setMessage("Select at least one trusted person who has enabled SOS alerts, or send a test alert.");
      return;
    }
    setSending(true); setMessage("");
    let payload: QueuedSos | undefined = existingDraft;
    try {
      let location: { latitude: number; longitude: number; accuracy: number; capturedAt: number } | undefined;
      if (!testMode && includeLocation) {
        try {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (permission.granted) {
            const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            location = { latitude: point.coords.latitude, longitude: point.coords.longitude,
              accuracy: point.coords.accuracy || 0, capturedAt: point.timestamp };
          }
        } catch { /* SOS can still be submitted without a location fix. */ }
      }
      payload ||= {
        clientAlertId: Crypto.randomUUID(), testMode,
        trustedUserIds: testMode ? [] : selected, externalContactIds: [],
        senderTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
        activatedAt: Date.now(), ...(location ? { location } : {}),
      };
      const result = await apiRequest<{ alert: SosAlert; message: string }>("/api/sos", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await deleteQueuedSos(user.userId, payload.clientAlertId).catch(() => undefined);
      await loadQueued();
      setMessage(result.message || (testMode ? "Test alert saved by KinGuardian." : "SOS saved by KinGuardian."));
      if (!testMode) setCooldown(30);
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        payload ||= {
          clientAlertId: Crypto.randomUUID(), testMode, trustedUserIds: testMode ? [] : selected,
          externalContactIds: [], senderTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
          activatedAt: Date.now(),
        };
        try {
          await saveQueuedSos(user.userId, payload);
          await loadQueued();
          setMessage("Not sent. The alert draft was saved in encrypted phone storage. Retry it only when you are back online and still need it.");
          if (!testMode) setCooldown(30);
        } catch (storageError) {
          setMessage(`Not sent: ${storageError instanceof Error ? storageError.message : error.message}`);
        }
      } else {
        setMessage(error instanceof Error ? `Not sent: ${error.message}` : "Not sent. Check your connection and call emergency services if you are in danger.");
      }
    } finally { setSending(false); setCountdown(null); }
  }, [includeLocation, loadQueued, selected, user.userId]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { setCountdown(null); void sendAlert(false); return; }
    const timer = setTimeout(() => setCountdown((value) => value === null ? null : value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, sendAlert]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function toggleRecipient(id: string) {
    setSelected((values) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  }

  return <Page title={`Hello, ${user.username}`} hint="Your safety tools are ready when you need them.">
    <Card>
      <View style={styles.homeSosHeading}><Text style={styles.sectionTitle}>SOS alert</Text><Pressable accessibilityRole="button" onPress={onOpenSettings} style={styles.sosSettingsButton}><Text style={styles.sosSettingsText}>SOS settings</Text></Pressable></View>
      <Text style={styles.body}>An SOS creates an in-app alert for the trusted people you select. It does not call emergency services.</Text>
      {connections.length ? <>
        <Text style={styles.label}>People who can receive an SOS</Text>
        {connections.map((person) => <Pressable key={person.connectionId} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(person.userId) }} onPress={() => toggleRecipient(person.userId)} style={[styles.selectRow, selected.includes(person.userId) && styles.selectedRow]}>
          <Text style={styles.body}>{selected.includes(person.userId) ? "☑  " : "□  "}{person.username}</Text>
        </Pressable>)}
      </> : <Notice>{busy ? "Loading trusted people…" : "No trusted people have enabled SOS alerts. You can still try a test alert."}</Notice>}
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: includeLocation }} onPress={() => setIncludeLocation((value) => !value)} style={styles.selectRow}>
        <Text style={styles.body}>{includeLocation ? "☑  Include this phone's current location" : "□  Include this phone's current location"}</Text>
      </Pressable>
      {countdown === null ? <View style={styles.buttonStack}>
        <ActionButton tone="danger" label={cooldown > 0 ? `SOS available again in ${cooldown}s` : "Start SOS countdown (10 seconds)"} disabled={sending || cooldown > 0} onPress={() => { setMessage(""); setCountdown(10); }} />
        {cooldown > 0 ? <>
          <Text accessibilityRole="timer" accessibilityLiveRegion="polite" style={styles.cooldownText}>Repeat reminder: {cooldown} seconds. If you still need help, you can send another SOS now.</Text>
          <ActionButton tone="quiet" label="I still need help · start another SOS" disabled={sending} onPress={() => { setCooldown(0); setMessage(""); setCountdown(10); }} />
        </> : null}
        <ActionButton tone="quiet" label="Send a test alert (no one is notified)" disabled={sending} onPress={() => { void sendAlert(true); }} />
      </View> : <View style={styles.buttonStack}>
        <Text accessibilityLiveRegion="assertive" style={styles.countdown}>SOS sends in {countdown} seconds</Text>
        <ActionButton tone="quiet" label="Cancel SOS" onPress={() => { setCountdown(null); setMessage("SOS cancelled before sending."); }} />
      </View>}
      {sending ? <ActivityIndicator color={colors.green} /> : null}
      {message ? <Notice danger={message.startsWith("Not sent:")}>{message}</Notice> : null}
      {queued.map((draft) => <View key={draft.clientAlertId} style={styles.journey}>
        <Text style={styles.body}>{draft.testMode ? "A test alert" : "An SOS alert"} is saved on this phone but has not been sent.</Text>
        <View style={styles.rowActions}>
          <Text onPress={() => { void sendAlert(draft.testMode, draft); }} style={styles.link}>Retry now</Text>
          <Text onPress={() => { void deleteQueuedSos(user.userId, draft.clientAlertId).then(loadQueued); }} style={styles.remove}>Delete draft</Text>
        </View>
      </View>)}
    </Card>
    <Card>
      <Text style={styles.sectionTitle}>Safe Journey</Text>
      <Text style={styles.body}>Start a timed journey from the Journeys tab. KinGuardian records the timer and can show alerts to the people you choose.</Text>
    </Card>
  </Page>;
}

export function PeopleScreen() {
  const [data, setData] = useState<ConnectionsResult>({ connections: [], requests: [], sentRequests: [] });
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try { setData(await apiRequest<ConnectionsResult>("/api/connections")); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load your trusted people."); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function sendRequest() {
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ message: string }>("/api/connections/request", { method: "POST", body: JSON.stringify({ username: username.trim() }) });
      setUsername(""); await load(); setMessage(result.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The request could not be sent."); }
    finally { setBusy(false); }
  }
  async function answer(id: string, action: "accept" | "reject") {
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ status: string }>(`/api/connections/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ action }) });
      await load();
      setMessage(result.status === "accepted" ? "Request accepted. Choose the alerts you want to receive." : "Request declined. This person was not added to your Trusted Circle.");
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "The request could not be updated."); }
    finally { setBusy(false); }
  }
  async function togglePreference(person: TrustedConnection, key: "receiveSos" | "receiveSafeJourneys" | "receiveLocation") {
    setBusy(true); setMessage("");
    try {
      await apiRequest(`/api/connections/${encodeURIComponent(person.connectionId)}`, {
        method: "PUT",
        body: JSON.stringify({
          receiveSos: key === "receiveSos" ? !person.receiveSos : person.receiveSos,
          receiveSafeJourneys: key === "receiveSafeJourneys" ? !person.receiveSafeJourneys : person.receiveSafeJourneys,
          receiveLocation: key === "receiveLocation" ? !person.receiveLocation : person.receiveLocation,
        }),
      });
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "That preference could not be changed."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    Alert.alert("Remove trusted person?", "They will no longer be able to receive your new safety alerts or location shares.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => { void (async () => {
        try { await apiRequest(`/api/connections/${encodeURIComponent(id)}`, { method: "DELETE" }); await load(); }
        catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove this connection."); }
      })(); } },
    ]);
  }

  return <Page title="Trusted people" hint="Both people must accept before safety information is shared." refreshing={refreshing} onRefresh={() => { void load(); }}>
    <Card><Text style={styles.sectionTitle}>Add someone</Text><Field label="Their KinGuardian username" value={username} onChangeText={setUsername} placeholder="Username" /><ActionButton label="Send request" busy={busy} onPress={() => { void sendRequest(); }} /></Card>
    <Card><Text style={styles.sectionTitle}>Your trusted people</Text>
      {data.connections.length ? data.connections.map((person) => <View key={person.connectionId} style={styles.personRow}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{person.username.slice(0, 1).toLocaleUpperCase()}</Text></View>
        <View style={styles.flex}><View style={styles.personHeading}><Text style={styles.personName}>@{person.username}</Text><Text style={styles.connectedBadge}>Trusted member</Text></View>
          <View style={styles.preferenceList}>
            <PreferenceToggle label="Receive SOS alerts" value={person.receiveSos} disabled={busy} onPress={() => { void togglePreference(person, "receiveSos"); }} />
            <PreferenceToggle label="Receive Safe Journey alerts" value={person.receiveSafeJourneys} disabled={busy} onPress={() => { void togglePreference(person, "receiveSafeJourneys"); }} />
            <PreferenceToggle label="Allow location sharing" value={person.receiveLocation} disabled={busy} onPress={() => { void togglePreference(person, "receiveLocation"); }} />
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${person.username} from your Trusted Circle`} onPress={() => remove(person.connectionId)} style={styles.removeButton}><Text style={styles.remove}>Remove</Text></Pressable>
      </View>) : <Text style={styles.body}>No accepted connections yet.</Text>}
    </Card>
    <Card><Text style={styles.sectionTitle}>Requests to you</Text>
      {data.requests.length ? data.requests.map((request) => <View key={request.connectionId} style={styles.requestRow}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{request.username.slice(0, 1).toLocaleUpperCase()}</Text></View>
        <View style={styles.flex}><Text style={styles.personName}>@{request.username}</Text><Text style={styles.hint}>Wants to join your Trusted Circle</Text><Text style={styles.pendingBadge}>Needs your answer</Text></View>
        <View style={styles.rowActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Accept request from ${request.username}`} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { void answer(request.connectionId, "accept"); }} style={styles.actionButton}><Text style={styles.actionButtonText}>Accept</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Decline request from ${request.username}`} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { void answer(request.connectionId, "reject"); }} style={styles.declineButton}><Text style={styles.declineButtonText}>Decline</Text></Pressable>
        </View>
      </View>) : <Text style={styles.body}>No incoming requests.</Text>}
    </Card>
    <Card><Text style={styles.sectionTitle}>Requests you sent</Text>{data.sentRequests.length ? data.sentRequests.map((item) => <View key={item.connectionId} style={styles.requestRow}><View style={styles.avatar}><Text style={styles.avatarText}>{item.username.slice(0, 1).toLocaleUpperCase()}</Text></View><View style={styles.flex}><Text style={styles.personName}>@{item.username}</Text><Text style={styles.hint}>Waiting for them to answer</Text></View><Text style={styles.pendingBadge}>Pending</Text></View>) : <Text style={styles.body}>No outgoing requests.</Text>}</Card>
    {data.recentReplies?.length ? <Card><Text style={styles.sectionTitle}>Recent answers</Text>{data.recentReplies.map((item) => <View key={item.connectionId} style={styles.requestRow}><View style={styles.avatar}><Text style={styles.avatarText}>{item.username.slice(0, 1).toLocaleUpperCase()}</Text></View><View style={styles.flex}><Text style={styles.personName}>@{item.username}</Text><Text style={styles.hint}>{item.status === "accepted" ? "Accepted your request" : "Declined your request"}</Text></View><Text style={item.status === "accepted" ? styles.connectedBadge : styles.declinedBadge}>{item.status === "accepted" ? "Accepted" : "Declined"}</Text></View>)}</Card> : null}
    {message ? <Notice danger={/could not|failed|unavailable|offline/iu.test(message)}>{message}</Notice> : null}
  </Page>;
}

function PreferenceToggle({ label, value, disabled, onPress }: { label: string; value: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={onPress} style={styles.preferenceToggle}>
    <Text style={styles.hint}>{value ? "☑" : "□"} {label}</Text>
  </Pressable>;
}

export function JourneysScreen() {
  const [connections, setConnections] = useState<TrustedConnection[]>([]);
  const [journeys, setJourneys] = useState<SafeJourney[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [duration, setDuration] = useState("60");
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [people, journeyData] = await Promise.all([
        apiRequest<ConnectionsResult>("/api/connections"), apiRequest<{ journeys: SafeJourney[] }>("/api/journeys"),
      ]);
      setConnections(people.connections.filter((item) => item.status === "accepted" && item.receiveSafeJourneys));
      setJourneys(journeyData.journeys);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load journeys."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function startJourney() {
    const minutes = Number(duration);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440 || selected.length === 0) {
      setMessage("Choose 15 to 1,440 minutes and at least one trusted person who allows journey alerts."); return;
    }
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ journey: SafeJourney; message?: string }>("/api/journeys", { method: "POST", body: JSON.stringify({
        clientJourneyId: Crypto.randomUUID(), durationMinutes: minutes, recipientUserIds: selected, startedAt: Date.now(),
      }) });
      setMessage(result.message || "Journey saved by KinGuardian."); setSelected([]); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The journey could not be started."); }
    finally { setBusy(false); }
  }

  async function finishJourney(journeyId: string) {
    const password = passwords[journeyId] || "";
    if (!password) { setMessage("Enter your password to finish this journey."); return; }
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ message: string }>(`/api/journeys/${encodeURIComponent(journeyId)}`, { method: "POST", body: JSON.stringify({ operation: "complete", password, attemptedAt: Date.now() }) });
      setMessage(result.message); setPasswords((values) => ({ ...values, [journeyId]: "" })); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The journey could not be completed."); }
    finally { setBusy(false); }
  }

  return <Page title="Safe Journeys" hint="Share a return timer with trusted people who opted in to journey alerts.">
    <Card><Text style={styles.sectionTitle}>Start a journey</Text>
      <Field label="Timer in minutes (15–1,440)" value={duration} onChangeText={setDuration} />
      {connections.length ? connections.map((person) => <Pressable key={person.connectionId} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(person.userId) }} onPress={() => setSelected((values) => values.includes(person.userId) ? values.filter((id) => id !== person.userId) : [...values, person.userId])} style={styles.selectRow}><Text style={styles.body}>{selected.includes(person.userId) ? "☑  " : "□  "}{person.username}</Text></Pressable>) : <Text style={styles.body}>No trusted people have enabled journey alerts yet.</Text>}
      <ActionButton label="Start Safe Journey" busy={busy} disabled={connections.length === 0} onPress={() => { void startJourney(); }} />
      {message ? <Notice>{message}</Notice> : null}
    </Card>
    <Card><Text style={styles.sectionTitle}>Journeys</Text>
      {journeys.length ? journeys.map((journey) => <View key={journey.journeyId} style={styles.journey}>
        <Text style={styles.personName}>{journey.isOwner ? "Your journey" : `${journey.username}'s journey`} · {journey.status}</Text>
        <Text style={styles.body}>Expected return: {new Date(journey.expectedReturnAt).toLocaleString()}</Text>
        {journey.isOwner && ["active", "overdue"].includes(journey.status) ? <>
          <Field label="Account password to finish" value={passwords[journey.journeyId] || ""} onChangeText={(value) => setPasswords((items) => ({ ...items, [journey.journeyId]: value }))} secure />
          <ActionButton tone="quiet" label="I am back — finish journey" busy={busy} onPress={() => { void finishJourney(journey.journeyId); }} />
        </> : null}
      </View>) : <Text style={styles.body}>No journeys to show.</Text>}
    </Card>
  </Page>;
}

export function AlertsScreen() {
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [alerts, setAlerts] = useState<SosAlert[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const [eventData, sosData] = await Promise.all([
        apiRequest<{ events: NotificationEvent[] }>("/api/notifications/events"), apiRequest<{ alerts: SosAlert[] }>("/api/sos"),
      ]);
      setEvents(eventData.events); setAlerts(sosData.alerts);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load alerts."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const label = (category: string) => category.replaceAll("_", " ");
  return <Page title="Alerts" hint="A saved alert does not confirm that a push notification was delivered.">
    {message ? <Notice>{message}</Notice> : null}
    <Card><Text style={styles.sectionTitle}>SOS history</Text>{alerts.length ? alerts.map((alert) => <View key={alert.alertId} style={styles.journey}>
      <Text style={styles.personName}>{alert.testMode ? "Test alert" : alert.isSender ? "Your SOS" : `SOS from ${alert.senderUsername}`}</Text>
      <Text style={styles.body}>{new Date(alert.createdAt).toLocaleString()} · {alert.status}</Text>
      {alert.location ? <Text style={styles.hint}>Location included: {alert.location.latitude.toFixed(4)}, {alert.location.longitude.toFixed(4)}</Text> : <Text style={styles.hint}>No location attached</Text>}
    </View>) : <Text style={styles.body}>No SOS alerts.</Text>}</Card>
    <Card><Text style={styles.sectionTitle}>Notification history</Text>{events.length ? events.map((event) => <View key={event.eventId} style={styles.journey}>
      <Text style={styles.personName}>{label(event.category)}</Text><Text style={styles.body}>{new Date(event.createdAt).toLocaleString()} · {event.status}</Text>
      {event.relatedUsername ? <Text style={styles.hint}>Related to {event.relatedUsername}</Text> : null}
    </View>) : <Text style={styles.body}>No notifications recorded yet.</Text>}</Card>
  </Page>;
}

export function SettingsScreen({ user, onSignOut, onOpenPeople }: Props & { onOpenPeople: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notificationSettings, setNotificationSettings] = useState({
    sos: true, invitations: true, safeJourneys: true, acknowledgements: true, accountSecurity: true,
  });
  const [nativePermission, setNativePermission] = useState("Checking phone permission…");
  const [pushAvailable, setPushAvailable] = useState(false);
  const [activeDeviceCount, setActiveDeviceCount] = useState(0);

  const loadNotificationSettings = useCallback(async () => {
    try {
      const [server, permission] = await Promise.all([
        apiRequest<{ preferences: typeof notificationSettings; pushAvailable: boolean; activeDeviceCount: number }>("/api/notifications"),
        Notifications.getPermissionsAsync(),
      ]);
      setNotificationSettings(server.preferences);
      setPushAvailable(server.pushAvailable);
      setActiveDeviceCount(server.activeDeviceCount);
      setNativePermission(permission.granted ? "Phone notifications are allowed." : "Phone notifications are off.");
    } catch (error) {
      setNativePermission(error instanceof Error ? error.message : "Notification settings could not be loaded.");
    }
  }, []);
  useFocusEffect(useCallback(() => { void loadNotificationSettings(); }, [loadNotificationSettings]));

  async function changeNotificationSetting(key: keyof typeof notificationSettings) {
    const next = { ...notificationSettings, [key]: !notificationSettings[key] };
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ preferences: typeof notificationSettings }>("/api/notifications/preferences", {
        method: "POST", body: JSON.stringify(next),
      });
      setNotificationSettings(result.preferences);
      setMessage("Notification preference saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The notification preference could not be saved."); }
    finally { setBusy(false); }
  }

  async function enablePhoneNotifications() {
    setBusy(true); setMessage("");
    try {
      const allowed = await requestNativeNotificationPermission();
      setNativePermission(allowed ? "Phone notifications are allowed." : "Phone notifications are off. Allow them in Android settings to receive notices.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Phone permission could not be requested."); }
    finally { setBusy(false); }
  }

  async function testPhoneNotification() {
    setBusy(true); setMessage("");
    try {
      await scheduleLocalNotificationTest();
      setNativePermission("A local test notification is scheduled for this phone.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The local test notification could not be scheduled."); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true);
    try { await logout(); onSignOut(); }
    catch { onSignOut(); }
    finally { setBusy(false); }
  }
  return <Page title="Settings" hint="Your account is shared with the KinGuardian website.">
    <Card><Text style={styles.sectionTitle}>Account</Text><Text style={styles.personName}>{user.username}</Text><Text style={styles.body}>Role: {user.role}</Text></Card>
    <Card><Text style={styles.sectionTitle}>SOS preferences</Text><Text style={styles.body}>Choose recipients for each SOS. The ten-second cancel step helps prevent mistakes, and location is optional each time. Your trusted people decide which alerts they allow.</Text><ActionButton tone="quiet" label="Manage Trusted Circle settings" onPress={onOpenPeople} /></Card>
    <Card><Text style={styles.sectionTitle}>Location privacy</Text><Text style={styles.body}>Location is requested only when you choose to include it in a safety action. The app does not show a live map or share location in the background yet.</Text></Card>
    <Card><Text style={styles.sectionTitle}>Phone notifications</Text>
      <Text accessibilityLiveRegion="polite" style={styles.body}>{nativePermission}</Text>
      <ActionButton tone="quiet" label="Allow phone notifications" busy={busy} onPress={() => { void enablePhoneNotifications(); }} />
      <ActionButton tone="quiet" label="Send a local test notification" busy={busy} onPress={() => { void testPhoneNotification(); }} />
      <Text style={styles.body}>The test only checks this phone. Remote Android safety alerts are not connected yet. Website push setup: {pushAvailable ? `${activeDeviceCount} subscribed browser(s)` : "not configured"}.</Text>
    </Card>
    <Card><Text style={styles.sectionTitle}>Alert preferences</Text>
      {([
        ["sos", "SOS alerts"], ["invitations", "Trusted Circle requests"], ["safeJourneys", "Safe Journey alerts"],
        ["acknowledgements", "Alert acknowledgements"], ["accountSecurity", "Account security notices"],
      ] as const).map(([key, label]) => <PreferenceToggle key={key} label={label} value={notificationSettings[key]} disabled={busy} onPress={() => { void changeNotificationSetting(key); }} />)}
    </Card>
    {message ? <Notice>{message}</Notice> : null}
    <ActionButton tone="quiet" label="Sign out" busy={busy} onPress={() => { void signOut(); }} />
  </Page>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: 18, paddingTop: 28, paddingBottom: 40, gap: 14, backgroundColor: colors.background, flexGrow: 1 },
  pageTitle: { color: colors.text, fontSize: 27, fontWeight: "800" },
  hint: { color: colors.muted, lineHeight: 19, fontSize: 13 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 16, gap: 12 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  homeSosHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 9 },
  sosSettingsButton: { minHeight: 40, justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12 },
  sosSettingsText: { color: colors.green, fontWeight: "700" },
  cooldownText: { color: colors.amber, textAlign: "center", lineHeight: 20 },
  body: { color: colors.muted, lineHeight: 20 },
  fieldWrap: { gap: 6 }, label: { color: colors.text, fontSize: 13, fontWeight: "600" },
  input: { minHeight: 46, borderRadius: 11, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, color: colors.text, backgroundColor: colors.background },
  notice: { color: colors.green, lineHeight: 20 }, danger: { color: colors.red },
  buttonStack: { gap: 10 }, countdown: { color: colors.red, textAlign: "center", fontSize: 23, fontWeight: "800", paddingVertical: 8 },
  selectRow: { color: colors.text, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, overflow: "hidden" },
  selectedRow: { borderColor: colors.green, backgroundColor: colors.surfaceRaised },
  personRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  personHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  avatar: { width: 42, height: 42, flex: 0, alignItems: "center", justifyContent: "center", borderRadius: 14, borderBottomLeftRadius: 5, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1 },
  avatarText: { color: colors.green, fontWeight: "800", fontSize: 16 },
  connectedBadge: { overflow: "hidden", color: colors.green, backgroundColor: colors.greenDark, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontWeight: "700" },
  pendingBadge: { overflow: "hidden", color: colors.amber, backgroundColor: colors.surfaceRaised, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: "700" },
  declinedBadge: { overflow: "hidden", color: colors.red, backgroundColor: colors.surfaceRaised, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: "700" },
  preferenceList: { gap: 4, marginTop: 6 }, preferenceToggle: { minHeight: 40, justifyContent: "center", paddingVertical: 5 },
  requestRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 13 },
  personName: { color: colors.text, fontSize: 15, fontWeight: "700" }, remove: { color: colors.red, fontWeight: "700" }, removeButton: { minHeight: 42, justifyContent: "center", paddingHorizontal: 7 },
  actionButton: { minHeight: 44, minWidth: 100, justifyContent: "center", alignItems: "center", borderRadius: 11, backgroundColor: colors.greenDark, paddingHorizontal: 14 },
  actionButtonText: { color: colors.white, fontWeight: "800" },
  declineButton: { minHeight: 44, minWidth: 100, justifyContent: "center", alignItems: "center", borderRadius: 11, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  declineButtonText: { color: colors.text, fontWeight: "700" },
  rowActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, link: { color: colors.green, fontWeight: "700", padding: 8 },
  journey: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 8 },
});
