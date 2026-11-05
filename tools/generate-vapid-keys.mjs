import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicJwk = publicKey.export({ format: "jwk" });
const privateJwk = privateKey.export({ format: "jwk" });

if (!publicJwk.x || !publicJwk.y || !privateJwk.d) {
  throw new Error("Node.js could not export the generated P-256 VAPID key pair.");
}

const publicBytes = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(publicJwk.x, "base64url"),
  Buffer.from(publicJwk.y, "base64url"),
]);

console.log("VAPID_PUBLIC_KEY=" + publicBytes.toString("base64url"));
console.log("VAPID_PRIVATE_KEY=" + privateJwk.d);
console.log("VAPID_SUBJECT=mailto:replace-with-your-contact-email@example.com");
console.log("\nKeep the private key and subject in local/Worker secrets. Do not commit them or put them in browser code.");
