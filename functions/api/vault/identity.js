import { requireSession } from "../../_shared/auth.js";
import { fromBase64Url, toBase64Url } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const IDENTITY_ALGORITHM = "ECDH-P256-HKDF-SHA256-AES256-GCM";

function identityResponse(row) {
  if (!row) return { identity: null };
  return { identity: {
    keyVersion: row.key_version,
    algorithm: row.algorithm,
    publicKey: toBase64Url(new Uint8Array(row.public_key)),
    privateKeyCiphertext: toBase64Url(new Uint8Array(row.private_key_ciphertext)),
    privateKeyIv: toBase64Url(new Uint8Array(row.private_key_iv)),
  } };
}

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const row = await context.env.DB.prepare(`
      SELECT key_version, algorithm, public_key, private_key_ciphertext, private_key_iv
      FROM user_sharing_keys WHERE user_id = ?
    `).bind(session.user.user_id).first();
    return jsonResponse(identityResponse(row));
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
    const body = await readJsonRequest(context.request, 4096);
    const publicKey = fromBase64Url(body.publicKey, { minimumBytes: 65, maximumBytes: 65 });
    const privateKeyCiphertext = fromBase64Url(body.privateKeyCiphertext, { minimumBytes: 64, maximumBytes: 512 });
    const privateKeyIv = fromBase64Url(body.privateKeyIv, { minimumBytes: 12, maximumBytes: 12 });
    if (!publicKey || !privateKeyCiphertext || !privateKeyIv || body.keyVersion !== 1
      || body.algorithm !== IDENTITY_ALGORITHM) {
      return jsonResponse({ error: { code: "INVALID_SHARING_KEY", message: "The encrypted location-sharing key is not valid." } }, 400);
    }
    const hasVault = await context.env.DB.prepare(
      "SELECT 1 AS present FROM encryption_metadata WHERE user_id = ? AND key_version = ?",
    ).bind(session.user.user_id, body.keyVersion).first();
    if (!hasVault) return jsonResponse({ error: { code: "VAULT_REQUIRED", message: "Create your encrypted private vault first." } }, 409);

    const existing = await context.env.DB.prepare(
      "SELECT 1 AS present FROM user_sharing_keys WHERE user_id = ?",
    ).bind(session.user.user_id).first();
    if (existing) return jsonResponse({ error: { code: "SHARING_KEY_EXISTS", message: "This account already has a location-sharing key." } }, 409);

    await context.env.DB.prepare(`
      INSERT INTO user_sharing_keys (
        user_id, key_version, algorithm, public_key, private_key_ciphertext, private_key_iv, created_at
      ) VALUES (?, 1, ?, ?, ?, ?, ?)
    `).bind(session.user.user_id, IDENTITY_ALGORITHM, publicKey, privateKeyCiphertext, privateKeyIv, Date.now()).run();
    return jsonResponse({ created: true, keyVersion: 1 }, 201);
  } catch (error) {
    return safeError(error);
  }
}
