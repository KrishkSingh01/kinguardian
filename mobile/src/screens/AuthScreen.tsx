import React, { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { recoverPassword, login, register } from "../api/client";
import type { MobileSession } from "../api/models";
import { saveSession } from "../auth/sessionStore";
import { ActionButton } from "../components/ActionButton";
import { TurnstileChallenge } from "../components/TurnstileChallenge";
import { colors } from "../theme/colors";

type Mode = "login" | "register" | "recover";
type Props = { onSignedIn: (session: MobileSession) => void };

export function AuthScreen({ onSignedIn }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [challengeVersion, setChallengeVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [pendingSession, setPendingSession] = useState<MobileSession | null>(null);

  async function submit() {
    setBusy(true); setError("");
    try {
      if (mode === "login") {
        if (!turnstileToken) throw new Error("Complete the security check first.");
        const session = await login(username.trim(), password, turnstileToken);
        onSignedIn(session);
      } else if (mode === "register") {
        if (password.length < 12) throw new Error("Use a password with at least 12 characters.");
        if (!turnstileToken) throw new Error("Complete the security check first.");
        const result = await register(username.trim(), password, turnstileToken);
        const { recoveryCodes: codes, ...session } = result;
        setPendingSession(session);
        setRecoveryCodes(codes);
      } else {
        if (password.length < 12) throw new Error("Use a new password with at least 12 characters.");
        const result = await recoverPassword(username.trim(), recoveryCode.trim(), password);
        Alert.alert("Password changed", result.message);
        setMode("login"); setPassword(""); setRecoveryCode("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request could not be completed.");
    } finally {
      setBusy(false);
      setTurnstileToken("");
      if (mode !== "recover") setChallengeVersion((value) => value + 1);
    }
  }

  async function savedRecoveryCodes() {
    if (!pendingSession) return;
    await saveSession(pendingSession);
    onSignedIn(pendingSession);
  }

  if (recoveryCodes && pendingSession) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>SAVE THESE ONCE</Text>
          <Text style={styles.title}>Keep your recovery codes safe.</Text>
          <Text style={styles.body}>Each code can reset your password once. Store them somewhere private. KinGuardian will not show them again.</Text>
          <View style={styles.codeBox}>{recoveryCodes.map((code) => <Text selectable key={code} style={styles.code}>{code}</Text>)}</View>
          <ActionButton label="I saved the codes" onPress={() => { void savedRecoveryCodes(); }} />
        </View>
      </ScrollView>
    );
  }

  const title = mode === "login" ? "Welcome back." : mode === "register" ? "Create your account." : "Reset your password.";
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}><Text style={styles.brandIcon}>◇</Text><Text style={styles.brandName}>kinguardian</Text></View>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>PERSONAL SAFETY, WITH YOUR CIRCLE</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{mode === "recover" ? "Use one saved recovery code to choose a new password." : "Use your KinGuardian username and password. Your account works with the website too."}</Text>
          <Text style={styles.label}>Username</Text>
          <TextInput accessibilityLabel="Username" autoCapitalize="none" autoCorrect={false} textContentType="username" value={username} onChangeText={setUsername} style={styles.input} />
          {mode === "recover" ? <>
            <Text style={styles.label}>Recovery code</Text>
            <TextInput accessibilityLabel="Recovery code" autoCapitalize="characters" autoCorrect={false} value={recoveryCode} onChangeText={setRecoveryCode} style={styles.input} />
          </> : null}
          <Text style={styles.label}>{mode === "recover" ? "New password" : "Password"}</Text>
          <TextInput accessibilityLabel={mode === "recover" ? "New password" : "Password"} autoCapitalize="none" autoCorrect={false}
            secureTextEntry textContentType={mode === "login" ? "password" : "newPassword"} value={password} onChangeText={setPassword} style={styles.input} />
          {mode !== "recover" ? <TurnstileChallenge key={`${mode}-${challengeVersion}`} action={mode} onToken={setTurnstileToken} /> : null}
          {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
          <View style={styles.submit}><ActionButton label={mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Change password"} busy={busy} onPress={() => { void submit(); }} /></View>
          <View style={styles.links}>
            {mode === "login" ? <>
              <Text style={styles.link} onPress={() => { setError(""); setMode("register"); }}>Create an account</Text>
              <Text style={styles.link} onPress={() => { setError(""); setMode("recover"); }}>Forgot password?</Text>
            </> : <Text style={styles.link} onPress={() => { setError(""); setMode("login"); }}>Back to sign in</Text>}
          </View>
          <Text style={styles.footnote}>For urgent danger, contact your local emergency services. KinGuardian does not dispatch emergency responders.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  page: { flexGrow: 1, justifyContent: "center", padding: 22, paddingTop: 48, paddingBottom: 48, gap: 18 },
  brand: { alignItems: "center", gap: 4 }, brandIcon: { color: colors.green, fontSize: 30 }, brandName: { color: colors.text, fontSize: 16, letterSpacing: 1 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 24, padding: 22, gap: 12 },
  eyebrow: { color: colors.green, fontSize: 11, fontWeight: "700", letterSpacing: 1.1 },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: 2 },
  body: { color: colors.muted, lineHeight: 21, marginBottom: 6 },
  label: { color: colors.text, fontWeight: "600", fontSize: 13, marginTop: 3 },
  input: { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, color: colors.text },
  submit: { marginTop: 8 },
  error: { color: colors.red, lineHeight: 19 },
  links: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginTop: 2 },
  link: { color: colors.green, fontWeight: "600", paddingVertical: 5 },
  footnote: { borderTopColor: colors.border, borderTopWidth: 1, color: colors.muted, fontSize: 12, lineHeight: 18, paddingTop: 12, marginTop: 6 },
  codeBox: { backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  code: { color: colors.text, width: "45%", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 13 },
});
