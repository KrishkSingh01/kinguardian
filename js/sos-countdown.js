export const SOS_COUNTDOWN_MS = 10_000;

export function getRemainingSOSCountdownSeconds(deadline, now = Date.now()) {
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
