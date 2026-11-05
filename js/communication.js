const MAX_MESSAGE_LENGTH = 500;
const MAX_COMPOSER_URL_LENGTH = 1_800;

/** Build a user-reviewed handoff URL for a native or official web composer. */
export function prepareCommunication(method, recipient, message, subject = "") {
  if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Write a message of ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }

  let url;
  if (method === "sms") {
    const phone = validInternationalNumber(recipient);
    url = `sms:${phone}?body=${encodeURIComponent(message.trim())}`;
  } else if (method === "email") {
    if (typeof recipient !== "string" || recipient.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipient)) {
      throw new Error("This contact does not have a valid email address.");
    }
    const [localPart, domain] = recipient.split("@");
    url = `mailto:${encodeURIComponent(localPart)}@${encodeURIComponent(domain)}?subject=${encodeURIComponent(subject.trim().slice(0, 120))}&body=${encodeURIComponent(message.trim())}`;
  } else if (method === "whatsapp") {
    const phone = validInternationalNumber(recipient).replaceAll("+", "");
    url = `https://wa.me/${phone}?text=${encodeURIComponent(message.trim())}`;
  } else {
    throw new Error("This communication method is not supported.");
  }

  if (url.length > MAX_COMPOSER_URL_LENGTH) {
    throw new Error("This message is too long for a reliable composer link. Shorten it and try again.");
  }
  return { method, url, status: "prepared" };
}

export function communicationProviderStatus(_method) {
  // Automatic providers are deliberately not configured in this zero-budget prototype.
  return "not_configured";
}

function validInternationalNumber(value) {
  if (typeof value !== "string" || !/^\+[1-9]\d{1,14}$/u.test(value)) {
    throw new Error("This contact does not have a valid international phone number.");
  }
  return value;
}
