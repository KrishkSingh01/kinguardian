const assert = require("node:assert/strict");
const test = require("node:test");

test("browser offline state wins over stale connection estimates", async () => {
  const { getNetworkSnapshot, networkStateLabel } = await import("../js/network-state.js");
  const snapshot = getNetworkSnapshot(false, { effectiveType: "4g", downlink: 20, rtt: 50 });
  assert.deepEqual(snapshot, { state: "offline", effectiveType: null, downlinkMbps: null, rttMs: null });
  assert.equal(networkStateLabel(snapshot), "Browser reports offline");
});

test("unsupported connection details stay unknown rather than fabricated", async () => {
  const { getNetworkSnapshot } = await import("../js/network-state.js");
  assert.deepEqual(getNetworkSnapshot(true, null), {
    state: "online", effectiveType: null, downlinkMbps: null, rttMs: null,
  });
});

test("slow browser estimates are labeled as approximate limitations", async () => {
  const { getNetworkSnapshot, networkStateLabel } = await import("../js/network-state.js");
  const twoG = getNetworkSnapshot(true, { effectiveType: "2g" });
  const highLatency = getNetworkSnapshot(true, { effectiveType: "4g", rtt: 900 });
  assert.equal(twoG.state, "limited");
  assert.match(networkStateLabel(twoG), /estimates a slow connection \(2g estimate\)/u);
  assert.equal(highLatency.state, "limited");
});

test("connection history stores only distinct states and keeps the newest twenty", async () => {
  const { appendNetworkEvent, getNetworkSnapshot, MAX_NETWORK_EVENTS } = await import("../js/network-state.js");
  const online = getNetworkSnapshot(true, { effectiveType: "4g", downlink: 30, rtt: 50 });
  const limited = getNetworkSnapshot(true, { effectiveType: "2g" });
  const first = appendNetworkEvent([], online, "2026-11-06T10:00:00.000Z");
  const duplicate = appendNetworkEvent(first.events, online, "2026-11-06T10:01:00.000Z");
  assert.equal(first.added, true);
  assert.equal(duplicate.added, false);
  const next = appendNetworkEvent(first.events, limited, "2026-11-06T10:02:00.000Z");
  assert.equal(next.events.length, 2);
  assert.equal(next.events[0].state, "limited");
  assert.equal("downlinkMbps" in next.events[0], false);
  assert.equal("rttMs" in next.events[0], false);

  let events = [];
  for (let index = 0; index < 24; index += 1) {
    const snapshot = getNetworkSnapshot(index % 2 === 0, null);
    events = appendNetworkEvent(events, snapshot, new Date(Date.UTC(2026, 10, 6, 10, index)).toISOString()).events;
  }
  assert.equal(events.length, MAX_NETWORK_EVENTS);
  assert.equal(events[0].state, "offline");
  assert.equal(events.every((event) => typeof event.occurredAt === "string"), true);
});
