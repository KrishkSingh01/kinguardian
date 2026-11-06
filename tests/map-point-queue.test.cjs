const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const queueModule = path.join(__dirname, "..", "js", "map-point-queue.js");

test("map queues the newest point for each marker while the map loads", async () => {
  const { queueLatestPoint } = await import(pathToFileURL(queueModule));
  const queue = [];
  queueLatestPoint(queue, { id: "share-a", latitude: 1, longitude: 2 });
  queueLatestPoint(queue, { id: "share-b", latitude: 3, longitude: 4 });
  queueLatestPoint(queue, { id: "share-a", latitude: 5, longitude: 6 });
  assert.deepEqual(queue, [
    { id: "share-a", latitude: 5, longitude: 6 },
    { id: "share-b", latitude: 3, longitude: 4 },
  ]);
});

test("map's pending marker queue drops its oldest point at the size limit", async () => {
  const { queueLatestPoint } = await import(pathToFileURL(queueModule));
  const queue = [{ id: "a" }, { id: "b" }];
  queueLatestPoint(queue, { id: "c" }, 2);
  assert.deepEqual(queue, [{ id: "b" }, { id: "c" }]);
});

test("map point queue rejects invalid limits and marker IDs", async () => {
  const { queueLatestPoint } = await import(pathToFileURL(queueModule));
  assert.throws(() => queueLatestPoint([], { latitude: 1 }, 10), TypeError);
  assert.throws(() => queueLatestPoint([], { id: "a" }, 0), TypeError);
});
