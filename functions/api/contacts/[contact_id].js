import { requireSession } from "../../_shared/auth.js";
import { fromBase64Url } from "../../_shared/crypto.js";
import { errorResponse, jsonResponse, readJsonRequest, requireSameOrigin, safeError } from "../../_shared/http.js";

export async function onRequestPut(context) {
  if (!requireSameOrigin(context.request)) return errorResponse("ORIGIN_REJECTED", 403, "This request did not come from KinGuardian.");
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const contactId = context.params.contact_id;
    if (!/^[0-9a-f-]{36}$/iu.test(contactId || "")) {
      return jsonResponse({ error: { code: "CONTACT_NOT_FOUND", message: "That contact was not found." } }, 404);
    }
    const vault = await context.env.DB.prepare(
      "SELECT key_version FROM encryption_metadata WHERE user_id = ?",
    ).bind(session.user.user_id).first();
    if (!vault) return jsonResponse({ error: { code: "VAULT_REQUIRED", message: "Create and unlock your private data vault first." } }, 409);
    const body = await readJsonRequest(context.request, 65_536);
    const ciphertext = fromBase64Url(body.ciphertext, { minimumBytes: 17, maximumBytes: 49_168 });
    const iv = fromBase64Url(body.iv, { minimumBytes: 12, maximumBytes: 12 });
    if (!ciphertext || !iv || body.keyVersion !== vault.key_version || body.payloadFormat !== 1
      || !Number.isInteger(body.priority) || body.priority < 0 || body.priority > 999) {
      return jsonResponse({ error: { code: "INVALID_CONTACT_RECORD", message: "The encrypted contact record is not valid." } }, 400);
    }
    const result = await context.env.DB.prepare(`
      UPDATE external_contacts SET priority = ?, details_ciphertext = ?, details_iv = ?,
        key_version = ?, updated_at = ?
      WHERE contact_id = ? AND owner_user_id = ? AND deleted_at IS NULL
    `).bind(body.priority, ciphertext, iv, vault.key_version, Date.now(), contactId, session.user.user_id).run();
    if (!result.meta?.changes) return jsonResponse({ error: { code: "CONTACT_NOT_FOUND", message: "That contact was not found." } }, 404);
    return jsonResponse({ contactId, updated: true });
  } catch (error) {
    return safeError(error);
  }
}

export async function onRequestDelete(context) {
  if (!requireSameOrigin(context.request)) return errorResponse("ORIGIN_REJECTED", 403, "This request did not come from KinGuardian.");
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const contactId = context.params.contact_id;
    if (!/^[0-9a-f-]{36}$/iu.test(contactId || "")) {
      return jsonResponse({ error: { code: "CONTACT_NOT_FOUND", message: "That contact was not found." } }, 404);
    }
    const now = Date.now();
    const result = await context.env.DB.prepare(`
      UPDATE external_contacts SET details_ciphertext = randomblob(length(details_ciphertext)),
        details_iv = randomblob(12), deleted_at = ?, updated_at = ?
      WHERE contact_id = ? AND owner_user_id = ? AND deleted_at IS NULL
    `).bind(now, now, contactId, session.user.user_id).run();
    if (!result.meta?.changes) return jsonResponse({ error: { code: "CONTACT_NOT_FOUND", message: "That contact was not found." } }, 404);
    return jsonResponse({ contactId, deleted: true });
  } catch (error) {
    return safeError(error);
  }
}
