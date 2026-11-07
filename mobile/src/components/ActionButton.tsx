import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../theme/colors";

type Props = { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; tone?: "primary" | "quiet" | "danger" };

export function ActionButton({ label, onPress, disabled = false, busy = false, tone = "primary" }: Props) {
  const backgroundColor = tone === "danger" ? "#7c2925" : tone === "quiet" ? colors.surfaceRaised : colors.greenDark;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} onPress={onPress}
      disabled={disabled || busy} style={({ pressed }) => [styles.button, { backgroundColor, opacity: disabled ? 0.5 : pressed ? 0.78 : 1 }]}>
      {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.text}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: 13, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 12 },
  text: { color: colors.white, fontSize: 15, fontWeight: "700", textAlign: "center" },
});
