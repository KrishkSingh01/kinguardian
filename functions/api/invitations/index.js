import { requireSession } from "../../_shared/auth.js";
import { randomToken, sha256 } from "../../_shared/crypto.js";
import { jsonResponse, requirePost, safeError } from "../../_shared/http.js";

const INVITATION_LIFETIME_MS = 24 * 60 * 60 * 1000;

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const result = await context.env.DB.prepare(`
      SELECT invitation_id, invitation_type, created_at, expires_at, redeemed_at, revoked_at
      FROM invitations
      WHERE issuer_user_id = ?
      ORDER BY created_at DESC LIMIT 50
    `).bind(session.user.user_id).all();
    const now = Date.now();
    return jsonResponse({ invitations: (result.results || []).map((row) => ({
      invitationId: row.invitation_id,
      invitationType: row.invitation_type,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      status: row.revoked_at ? "revoked" : row.redeemed_at ? "accepted" : row.expires_at <= now ? "expired" : "pending",
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
    const invitationToken = randomToken(32);
    const tokenHash = await sha256(invitationToken);
    const invitationId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + INVITATION_LIFETIME_MS;
    await context.env.DB.prepare(`
      INSERT INTO invitations (
        invitation_id, token_hash, issuer_user_id, invitation_type, created_at, expires_at
      ) VALUES (?, ?, ?, 'trusted_connection', ?, ?)
    `).bind(invitationId, tokenHash, session.user.user_id, now, expiresAt).run();

    const inviteUrl = new URL("invite.html", new URL(context.request.url).origin);
    inviteUrl.hash = invitationToken;
    return jsonResponse({
      invitationId,
      inviteUrl: inviteUrl.href,
      manualCode: invitationToken,
      expiresAt,
      warning: "This single-use link is valid for 24 hours. Share it only with the person you intend to invite.",
    }, 201);
  } catch (error) {
    return safeError(error);
  }
}
