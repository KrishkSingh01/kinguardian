import { requireSession } from "../../_shared/auth.js";
import { jsonResponse, safeError } from "../../_shared/http.js";

export async function onRequestGet(context) {
  try {
    const session = await requireSession(context, { allowPasswordChange: true });
    if (session.response) return session.response;
    return jsonResponse({
      user: {
        userId: session.user.user_id,
        username: session.user.username,
        role: session.user.role,
        mustChangePassword: Boolean(session.user.must_change_password),
      },
    });
  } catch (error) {
    return safeError(error);
  }
}
