import { requireSession } from "../../_shared/auth.js";
import { jsonResponse, readJsonRequest, requirePost, safeError } from "../../_shared/http.js";

const MAX_RECIPIENTS = 20;

function validId(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function alertSummary(row) {
  return {
    alertId: row.alert_id,
    senderUserId: row.sender_user_id,
    senderUsername: row.sender_username,
    isSender: Boolean(row.is_sender),
    testMode: Boolean(row.test_mode),
    status: row.alert_status,
    createdAt: row.created_at,
    senderTimezone: row.sender_timezone,
    recipientStatus: row.recipient_status,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
  };
}

function creationMessage(testMode) {
  return testMode
    ? "Test alert accepted by the server. No recipients were selected and no contact was notified."
    : "Alert accepted by the server. No contact has been notified by this prototype yet.";
}

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context);
    if (session.response) return session.response;
    const result = await context.env.DB.prepare(`
      SELECT a.alert_id, a.sender_user_id, a.test_mode, a.alert_status, a.created_at,
             a.sender_timezone, a.resolved_at, a.closed_at, u.username AS sender_username,
             r.recipient_status, r.acknowledged_at,
             CASE WHEN a.sender_user_id = ? THEN 1 ELSE 0 END AS is_sender
      FROM sos_alerts AS a
      JOIN users AS u ON u.user_id = a.sender_user_id
      LEFT JOIN sos_alert_recipients AS r
        ON r.alert_id = a.alert_id AND r.recipient_user_id = ?
      WHERE a.sender_user_id = ? OR r.recipient_user_id = ?
      ORDER BY a.created_at DESC LIMIT 50
    `).bind(session.user.user_id, session.user.user_id, session.user.user_id, session.user.user_id).all();
    return jsonResponse({ alerts: (result.results || []).map(alertSummary) });
  } catch (error) {
    return safeError(error);
  }
}

export async function onRequestPost(context) {
  const rejected = requirePost(context);
  if (rejected) return rejected;
  let idempotencyKey;
  try {
    const session = await requireSession(context, { write: true });
    if (session.response) return session.response;
    const body = await readJsonRequest(context.request, 16_384);
    const trustedUserIds = body.trustedUserIds ?? [];
    const externalContactIds = body.externalContactIds ?? [];
    if (typeof body.testMode !== "boolean" || !validId(body.clientAlertId)
      || typeof body.senderTimezone !== "string"
      || !Array.isArray(trustedUserIds) || !Array.isArray(externalContactIds)
      || trustedUserIds.length > MAX_RECIPIENTS || externalContactIds.length > MAX_RECIPIENTS
      || trustedUserIds.some((id) => !validId(id)) || externalContactIds.some((id) => !validId(id))
      || new Set(trustedUserIds).size !== trustedUserIds.length
      || new Set(externalContactIds).size !== externalContactIds.length
      || trustedUserIds.length + externalContactIds.length > MAX_RECIPIENTS) {
      return jsonResponse({ error: { code: "INVALID_ALERT", message: "The alert details are not valid." } }, 400);
    }
    idempotencyKey = body.clientAlertId;
    try {
      new Intl.DateTimeFormat("en", { timeZone: body.senderTimezone });
    } catch {
      return jsonResponse({ error: { code: "INVALID_TIME_ZONE", message: "Choose a valid device time zone and try again." } }, 400);
    }
    if (body.testMode && (trustedUserIds.length || externalContactIds.length)) {
      return jsonResponse({ error: { code: "TEST_MODE_RECIPIENTS_BLOCKED", message: "Test alerts cannot include recipients." } }, 400);
    }
    if (!body.testMode && trustedUserIds.length + externalContactIds.length === 0) {
      return jsonResponse({ error: { code: "RECIPIENT_REQUIRED", message: "Choose at least one trusted recipient, or turn on test mode." } }, 400);
    }

    const existing = await context.env.DB.prepare(`
      SELECT alert_id, sender_user_id, test_mode, alert_status, created_at, sender_timezone,
             resolved_at, closed_at, ? AS sender_username, 1 AS is_sender
      FROM sos_alerts WHERE sender_user_id = ? AND client_alert_id = ?
    `).bind(session.user.username, session.user.user_id, body.clientAlertId).first();
    if (existing) return jsonResponse({
      alert: alertSummary(existing), idempotentReplay: true,
      notificationAttempted: false, message: creationMessage(Boolean(existing.test_mode)),
    });

    for (const recipientId of trustedUserIds) {
      const allowed = await context.env.DB.prepare(`
        SELECT 1 AS allowed
        FROM trusted_connections AS c
        JOIN users AS recipient ON recipient.user_id = ? AND recipient.account_status = 'active'
        JOIN trusted_connection_preferences AS p
          ON p.connection_id = c.connection_id AND p.recipient_user_id = recipient.user_id
        WHERE c.connection_status = 'accepted'
          AND p.receive_sos = 1
          AND ((c.user_low_id = ? AND c.user_high_id = recipient.user_id)
            OR (c.user_high_id = ? AND c.user_low_id = recipient.user_id))
        LIMIT 1
      `).bind(recipientId, session.user.user_id, session.user.user_id).first();
      if (!allowed) return jsonResponse({ error: { code: "RECIPIENT_NOT_ALLOWED", message: "A selected trusted recipient is unavailable or has not enabled SOS alerts." } }, 403);
    }

    for (const contactId of externalContactIds) {
      const allowed = await context.env.DB.prepare(`
        SELECT 1 AS allowed FROM external_contacts
        WHERE contact_id = ? AND owner_user_id = ? AND deleted_at IS NULL
      `).bind(contactId, session.user.user_id).first();
      if (!allowed) return jsonResponse({ error: { code: "RECIPIENT_NOT_ALLOWED", message: "A selected external contact is unavailable." } }, 403);
    }

    const alertId = crypto.randomUUID();
    const now = Date.now();
    const statements = [context.env.DB.prepare(`
      INSERT INTO sos_alerts (
        alert_id, client_alert_id, sender_user_id, test_mode, alert_status,
        created_at, sender_timezone
      ) VALUES (?, ?, ?, ?, 'accepted_by_server', ?, ?)
    `).bind(alertId, body.clientAlertId, session.user.user_id, body.testMode ? 1 : 0, now, body.senderTimezone)];

    for (const recipientId of trustedUserIds) {
      statements.push(context.env.DB.prepare(`
        INSERT INTO sos_alert_recipients (
          alert_recipient_id, alert_id, recipient_user_id, external_contact_id, created_at
        ) SELECT ?, ?, recipient.user_id, NULL, ?
          FROM users AS recipient
          WHERE recipient.user_id = ? AND recipient.account_status = 'active'
            AND EXISTS (
              SELECT 1 FROM trusted_connections AS c
              JOIN trusted_connection_preferences AS p
                ON p.connection_id = c.connection_id AND p.recipient_user_id = recipient.user_id
              WHERE c.connection_status = 'accepted' AND p.receive_sos = 1
                AND ((c.user_low_id = ? AND c.user_high_id = recipient.user_id)
                  OR (c.user_high_id = ? AND c.user_low_id = recipient.user_id))
            )
      `).bind(crypto.randomUUID(), alertId, now, recipientId, session.user.user_id, session.user.user_id));
    }
    for (const contactId of externalContactIds) {
      statements.push(context.env.DB.prepare(`
        INSERT INTO sos_alert_recipients (
          alert_recipient_id, alert_id, recipient_user_id, external_contact_id, created_at
        ) SELECT ?, ?, NULL, contact.contact_id, ? FROM external_contacts AS contact
          WHERE contact.contact_id = ? AND contact.owner_user_id = ? AND contact.deleted_at IS NULL
      `).bind(crypto.randomUUID(), alertId, now, contactId, session.user.user_id));
    }

    statements.push(context.env.DB.prepare(`
      INSERT INTO notification_events (
        event_id, event_key, user_id, category, delivery_status, created_at, updated_at, related_resource_id
      ) SELECT lower(hex(randomblob(16))), 'sos:' || a.alert_id || ':' || r.recipient_user_id,
        r.recipient_user_id, 'sos', 'prepared', ?, ?, a.alert_id
      FROM sos_alerts AS a
      JOIN sos_alert_recipients AS r ON r.alert_id = a.alert_id AND r.recipient_user_id IS NOT NULL
      WHERE a.alert_id = ? AND a.test_mode = 0
      ON CONFLICT (event_key) DO NOTHING
    `).bind(now, now, alertId));

    const results = await context.env.DB.batch(statements);
    const rowsExpected = trustedUserIds.length + externalContactIds.length;
    const recipientsCreated = results.slice(1).filter((result) => result?.meta?.changes === 1).length;
    if (recipientsCreated !== rowsExpected) {
      await context.env.DB.batch([
        context.env.DB.prepare("DELETE FROM notification_events WHERE related_resource_id = ? AND category = 'sos'").bind(alertId),
        context.env.DB.prepare("DELETE FROM sos_alert_recipients WHERE alert_id = ?").bind(alertId),
        context.env.DB.prepare("DELETE FROM sos_alerts WHERE alert_id = ? AND sender_user_id = ?")
          .bind(alertId, session.user.user_id),
      ]);
      return jsonResponse({ error: { code: "RECIPIENT_CHANGED", message: "A recipient’s settings changed. Refresh your circle and try again." } }, 409);
    }

    const alert = {
      alert_id: alertId,
      sender_user_id: session.user.user_id,
      sender_username: session.user.username,
      is_sender: 1,
      test_mode: body.testMode ? 1 : 0,
      alert_status: "accepted_by_server",
      created_at: now,
      sender_timezone: body.senderTimezone,
      recipient_status: null,
      acknowledged_at: null,
      resolved_at: null,
      closed_at: null,
    };
    return jsonResponse({
      alert: alertSummary(alert),
      idempotentReplay: false,
      notificationAttempted: false,
      message: creationMessage(body.testMode),
    }, 201);
  } catch (error) {
    try {
      const session = await requireSession(context);
      if (!session.response) {
        const existing = await context.env.DB.prepare(`
          SELECT alert_id, sender_user_id, test_mode, alert_status, created_at, sender_timezone,
                 resolved_at, closed_at, ? AS sender_username, 1 AS is_sender
          FROM sos_alerts WHERE sender_user_id = ? AND client_alert_id = ?
        `).bind(session.user.username, session.user.user_id, idempotencyKey).first();
        if (existing) return jsonResponse({
          alert: alertSummary(existing), idempotentReplay: true,
          notificationAttempted: false, message: creationMessage(Boolean(existing.test_mode)),
        });
      }
    } catch { /* return the original safe error below */ }
    return safeError(error);
  }
}
