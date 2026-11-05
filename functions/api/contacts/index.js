import { requireSession } from "../../_shared/auth.js";
import { fromBase64Url, toBase64Url } from "../../_shared/crypto.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

async function activeVault(context, userId) {
  return context.env.DB.prepare(
    "SELECT key_version FROM encryption_metadata WHERE user_id = ?",
  ).bind(userId).first();
}

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const vault = await activeVault(context, session.user.user_id);
    if (!vault) return jsonResponse({ contacts: [], vaultRequired: true });
    const result = await context.env.DB.prepare(`
      SELECT contact_id, priority, details_ciphertext, details_iv, key_version, payload_format,
             created_at, updated_at
      FROM external_contacts
      WHERE owner_user_id = ? AND deleted_at IS NULL
      ORDER BY priority ASC, created_at ASC
    `).bind(session.user.user_id).all();
    return jsonResponse({ contacts: (result.results || []).map((row) => ({
      contactId: row.contact_id,
      priority: row.priority,
      ciphertext: toBase64Url(new Uint8Array(row.details_ciphertext)),
      iv: toBase64Url(new Uint8Array(row.details_iv)),
      keyVersion: row.key_version,
      payloadFormat: row.payload_format,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) });
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
    const vault = await activeVault(context, session.user.user_id);
    if (!vault) return jsonResponse({ error: { code: "VAULT_REQUIRED", message: "Create and unlock your private data vault first." } }, 409);
    const body = await readJsonRequest(context.request, 65_536);
    const ciphertext = fromBase64Url(body.ciphertext, { minimumBytes: 17, maximumBytes: 49_168 });
    const iv = fromBase64Url(body.iv, { minimumBytes: 12, maximumBytes: 12 });
    if (!ciphertext || !iv || body.keyVersion !== vault.key_version || body.payloadFormat !== 1
      || !/^[0-9a-f-]{36}$/iu.test(body.contactId || "")
      || !Number.isInteger(body.priority) || body.priority < 0 || body.priority > 999) {
      return jsonResponse({ error: { code: "INVALID_CONTACT_RECORD", message: "The encrypted contact record is not valid." } }, 400);
    }
    const contactId = body.contactId;
    const now = Date.now();
    await context.env.DB.prepare(`
      INSERT INTO external_contacts (
        contact_id, owner_user_id, priority, details_ciphertext, details_iv,
        key_version, created_at, updated_at, payload_format
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(contactId, session.user.user_id, body.priority, ciphertext, iv, vault.key_version, now, now).run();
    return jsonResponse({ contactId, keyVersion: vault.key_version, createdAt: now }, 201);
  } catch (error) {
    return safeError(error);
  }
}
