export function queueLatestPoint(queue, point, limit = 100) {
  if (!Array.isArray(queue) || !point || typeof point.id !== "string" || !point.id
    || !Number.isInteger(limit) || limit < 1) {
    throw new TypeError("A queue, point ID, and positive integer limit are required.");
  }
  const existingIndex = queue.findIndex((queued) => queued.id === point.id);
  if (existingIndex >= 0) {
    queue[existingIndex] = point;
    return;
  }
  if (queue.length >= limit) queue.shift();
  queue.push(point);
}
