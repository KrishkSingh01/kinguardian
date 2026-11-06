const CONNECTION_TYPES = new Set(["slow-2g", "2g", "3g", "4g"]);
const EVENT_STATES = new Set(["online", "limited", "offline"]);
export const MAX_NETWORK_EVENTS = 20;

function positiveNumber(value, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max
    ? value
    : null;
}

export function getNetworkSnapshot(isOnline, connectionInfo) {
  if (!isOnline) {
    return { state: "offline", effectiveType: null, downlinkMbps: null, rttMs: null };
  }
  const effectiveType = CONNECTION_TYPES.has(connectionInfo?.effectiveType)
    ? connectionInfo.effectiveType
    : null;
  const downlinkMbps = positiveNumber(connectionInfo?.downlink, 100_000);
  const rttMs = positiveNumber(connectionInfo?.rtt, 60_000);
  const limited = effectiveType === "slow-2g" || effectiveType === "2g"
    || (downlinkMbps !== null && downlinkMbps <= 0.5)
    || (rttMs !== null && rttMs >= 500);

  return {
    state: limited ? "limited" : "online",
    effectiveType,
    downlinkMbps,
    rttMs,
  };
}

export function networkStateLabel(snapshot) {
  if (snapshot.state === "offline") return "Browser reports offline";
  if (snapshot.state === "limited") {
    const type = snapshot.effectiveType ? ` (${snapshot.effectiveType} estimate)` : "";
    return `Browser estimates a slow connection${type}`;
  }
  return "Browser reports online";
}

export function isNetworkEvent(value) {
  return Boolean(value && typeof value === "object"
    && EVENT_STATES.has(value.state)
    && (value.effectiveType === null || CONNECTION_TYPES.has(value.effectiveType))
    && typeof value.occurredAt === "string"
    && Number.isFinite(Date.parse(value.occurredAt)));
}

function fingerprint(value) {
  return `${value.state}:${value.effectiveType || "unspecified"}`;
}

export function appendNetworkEvent(existing, snapshot, occurredAt = new Date().toISOString()) {
  const events = Array.isArray(existing) ? existing.filter(isNetworkEvent).slice(0, MAX_NETWORK_EVENTS) : [];
  const nextEvent = {
    state: snapshot.state,
    effectiveType: snapshot.effectiveType,
    occurredAt,
  };
  if (events.length && fingerprint(events[0]) === fingerprint(nextEvent)) {
    return { events, added: false };
  }
  return {
    events: [nextEvent, ...events].slice(0, MAX_NETWORK_EVENTS),
    added: true,
  };
}
