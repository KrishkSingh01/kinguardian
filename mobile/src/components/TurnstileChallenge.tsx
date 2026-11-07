import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import { apiBaseUrl } from "../api/client";
import { colors } from "../theme/colors";

type Props = { action: "login" | "register"; onToken: (token: string) => void };

export function TurnstileChallenge({ action, onToken }: Props) {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading the security check…");
  const source = useMemo(() => ({ uri: `${apiBaseUrl()}/mobile-turnstile.html?action=${action}` }), [action]);

  function handleMessage(event: WebViewMessageEvent) {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type?: string; action?: string; token?: string; message?: string };
      if (data.type === "turnstile-token" && data.action === action && typeof data.token === "string" && data.token.length > 0) {
        onToken(data.token);
        setMessage("Security check complete.");
      } else if (data.type === "turnstile-status" && typeof data.message === "string") {
        setMessage(data.message);
      }
    } catch {
      setMessage("The security check could not be read. Reload and try again.");
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Security check</Text>
      <View style={styles.webview}>
        <WebView
          source={source}
          originWhitelist={["https://*"]}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          mixedContentMode="never"
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onMessage={handleMessage}
          onError={() => { setLoading(false); setMessage("Could not load the security check. Check your connection and reload."); }}
          onShouldStartLoadWithRequest={(request) => {
            try {
              const host = new URL(request.url).hostname;
              return host === "kinguardian.pages.dev" || host === "challenges.cloudflare.com";
            } catch { return false; }
          }}
        />
        {loading ? <View style={styles.loading}><ActivityIndicator color={colors.green} /></View> : null}
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.status}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 7, marginTop: 10 },
  label: { color: colors.text, fontWeight: "600" },
  webview: { height: 94, overflow: "hidden", borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  status: { color: colors.muted, fontSize: 12 },
});
