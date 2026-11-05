import { jsonResponse, safeError } from "../../_shared/http.js";

export async function onRequestGet({ env }) {
  try {
    const [owner, bootstrap] = await Promise.all([
      env.DB.prepare("SELECT 1 AS present FROM users WHERE role = 'owner' LIMIT 1").first(),
      env.DB.prepare("SELECT consumed_at FROM owner_bootstrap WHERE singleton_id = 1").first(),
    ]);
    return jsonResponse({
      ownerExists: Boolean(owner),
      setupAvailable: Boolean(
        env.OWNER_BOOTSTRAP_SECRET?.length >= 32
        && env.AUTH_RATE_LIMIT_SECRET?.length >= 32
        && !bootstrap?.consumed_at
        && !owner,
      ),
    });
  } catch (error) {
    return safeError(error);
  }
}
