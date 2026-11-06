import { processPushQueue } from "./push-delivery.js";
import { markDueJourneysOverdue } from "./safe-journey-scheduler.js";

async function processScheduledWork(DB, now) {
  await markDueJourneysOverdue(DB, now);
  await DB.batch([
    DB.prepare(`UPDATE location_shares SET share_status = 'expired', stopped_at = ?
      WHERE share_status = 'active' AND expires_at <= ?`).bind(now, now),
    DB.prepare(`DELETE FROM encrypted_location_envelopes WHERE share_id IN (
      SELECT share_id FROM location_shares WHERE share_status = 'expired'
    )`),
    DB.prepare(`DELETE FROM location_share_points WHERE share_id IN (
      SELECT share_id FROM location_shares WHERE share_status = 'expired'
    )`),
  ]);
}

export default {
  async scheduled(_event, env, context) {
    context.waitUntil((async () => {
      const now = Date.now();
      await processScheduledWork(env.DB, now);
      await processPushQueue(env, now);
    })());
  },
};

