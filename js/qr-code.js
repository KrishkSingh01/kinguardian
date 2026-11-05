import encodeQR from "qr";

const MAX_QR_TEXT_LENGTH = 2048;

export function makeQrSvg(text) {
  if (typeof text !== "string" || text.length < 1 || text.length > MAX_QR_TEXT_LENGTH) {
    throw new TypeError("QR content must be a short, non-empty string.");
  }
  return encodeQR(text, "svg", { ecc: "quartile", border: 4 });
}

export function makeQrDataUrl(text) {
  const svg = makeQrSvg(text);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
