import { requireSession } from "../../_shared/auth.js";
import { fromBase64Url, toBase64Url } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const row = await context.env.DB.prepare(`
      SELECT key_version, wrapping_algorithm, kdf_algorithm, kdf_iterations,
             kdf_salt, wrapped_key, wrapping_iv, created_at, updated_at
      FROM encryption_metadata WHERE user_id = ?
    `).bind(session.user.user_id).first();
    if (!row) return jsonResponse({ vault: null });
    return jsonResponse({ vault: {
      keyVersion: row.key_version,
      wrappingAlgorithm: row.wrapping_algorithm,
      kdfAlgorithm: row.kdf_algorithm,
      kdfIterations: row.kdf_iterations,
      kdfSalt: toBase64Url(new Uint8Array(row.kdf_salt)),
      wrappedKey: toBase64Url(new Uint8Array(row.wrapped_key)),
      wrappingIv: toBase64Url(new Uint8Array(row.wrapping_iv)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } });
  } catch (error) {
    return safeError(error);
  }
}

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const existing = await context.env.DB.prepare(
      "SELECT 1 AS present FROM encryption_metadata WHERE user_id = ?",
    ).bind(session.user.user_id).first();
    if (existing) {
      return jsonResponse({ error: { code: "VAULT_ALREADY_EXISTS", message: "This account already has an encryption vault." } }, 409);
    }

    const body = await readJsonRequest(context.request, 4096);
    const salt = fromBase64Url(body.kdfSalt, { minimumBytes: 16, maximumBytes: 64 });
    const wrappedKey = fromBase64Url(body.wrappedKey, { minimumBytes: 48, maximumBytes: 128 });
    const wrappingIv = fromBase64Url(body.wrappingIv, { minimumBytes: 12, maximumBytes: 12 });
    if (!salt || !wrappedKey || !wrappingIv || body.keyVersion !== 1
      || body.wrappingAlgorithm !== "AES-256-GCM"
      || body.kdfAlgorithm !== "PBKDF2-HMAC-SHA-256"
      || body.kdfIterations !== 600_000) {
      return jsonResponse({ error: { code: "INVALID_VAULT", message: "The encrypted vault details are not valid." } }, 400);
    }
    const now = Date.now();
    await context.env.DB.prepare(`
      INSERT INTO encryption_metadata (
        user_id, key_version, wrapping_algorithm, kdf_algorithm, kdf_iterations,
        kdf_salt, wrapped_key, wrapping_iv, created_at, updated_at
      ) VALUES (?, 1, 'AES-256-GCM', 'PBKDF2-HMAC-SHA-256', 600000, ?, ?, ?, ?, ?)
    `).bind(session.user.user_id, salt, wrappedKey, wrappingIv, now, now).run();
    return jsonResponse({ created: true, keyVersion: 1 }, 201);
  } catch (error) {
    return safeError(error);
  }
}
