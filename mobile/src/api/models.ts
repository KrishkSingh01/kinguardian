export type User = {
  userId: string;
  username: string;
  role: "member" | "owner";
  mustChangePassword: boolean;
};

export type MobileSession = {
  user: User;
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
};

export type TrustedConnection = {
  connectionId: string;
  userId: string;
  username: string;
  status: "pending" | "accepted" | "rejected" | "removed";
  requestedByUserId: string;
  receiveSos: boolean;
  receiveSafeJourneys: boolean;
  receiveLocation: boolean;
  shareLocation: boolean;
};

export type SafeJourney = {
  journeyId: string;
  userId?: string;
  username: string;
  status: "active" | "overdue" | "completed" | "cancelled";
  startedAt: number;
  expectedReturnAt: number;
  isOwner?: boolean;
  recipientNames?: { userId: string; username: string }[];
};

export type NotificationEvent = {
  eventId: string;
  category: string;
  status: string;
  createdAt: number;
  readAt: number | null;
  resourceId: string | null;
  relatedUsername: string | null;
};

export type SosAlert = {
  alertId: string;
  senderUsername: string;
  isSender: boolean;
  testMode: boolean;
  status: string;
  createdAt: number;
  location: { latitude: number; longitude: number; accuracy: number; capturedAt: number } | null;
};
