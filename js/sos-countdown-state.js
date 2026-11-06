const PRESET_DURATIONS = new Set([5, 10, 15, 30, 60]);
const MIN_CUSTOM_DURATION = 5;
const MAX_CUSTOM_DURATION = 300;

export function getCountdownDuration(selection, customValue) {
  if (selection === "custom") {
    const duration = Number(customValue);
    if (!Number.isInteger(duration) || duration < MIN_CUSTOM_DURATION || duration > MAX_CUSTOM_DURATION) {
      throw new Error("Enter a whole number from 5 to 300 seconds.");
    }
    return duration;
  }
  const duration = Number(selection);
  if (!PRESET_DURATIONS.has(duration)) throw new Error("Choose a valid countdown length.");
  return duration;
}

export function getRemainingCountdownSeconds(deadline, now = Date.now()) {
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
