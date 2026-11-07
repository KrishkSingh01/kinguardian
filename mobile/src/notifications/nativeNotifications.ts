import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

export const NOTIFICATION_CHANNELS = {
  safety: "safety-alerts",
  trustedPeople: "trusted-people",
  account: "account-updates",
  general: "general",
} as const;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function configureNativeNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  const definitions = [
    { id: NOTIFICATION_CHANNELS.safety, name: "Safety alerts", description: "SOS and urgent safety updates." },
    { id: NOTIFICATION_CHANNELS.trustedPeople, name: "Trusted people", description: "Trusted Circle requests and replies." },
    { id: NOTIFICATION_CHANNELS.account, name: "Account security", description: "Important account security updates." },
    { id: NOTIFICATION_CHANNELS.general, name: "KinGuardian", description: "General KinGuardian notifications." },
  ];
  await Promise.all(definitions.map(({ id, name, description }) => Notifications.setNotificationChannelAsync(id, {
    name,
    description,
    importance: id === NOTIFICATION_CHANNELS.safety ? Notifications.AndroidImportance.MAX : Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: id === NOTIFICATION_CHANNELS.safety ? [0, 350, 180, 350] : [0, 180],
    lightColor: "#17714b",
    sound: "default",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    bypassDnd: false,
  })));
}

export async function requestNativeNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function scheduleLocalNotificationTest(): Promise<void> {
  const allowed = await requestNativeNotificationPermission();
  if (!allowed) throw new Error("Allow notifications in Android settings, then try again.");
  await configureNativeNotificationChannels();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "KinGuardian test notification",
      body: "This local test appeared on this phone. It does not contact your trusted people.",
      sound: "default",
      data: { kind: "local-test" },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: NOTIFICATION_CHANNELS.general },
  });
}
