import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type Sealed = { ciphertext: string; iv: string; auth_tag: string };

function encryptionKey(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("KEY_ENCRYPTION_SECRET is missing or shorter than 32 characters.");
  }
  return createHash("sha256").update(secret).digest();
}

export function isEncryptionConfigured() {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  return Boolean(secret && secret.length >= 32);
}

// AES-256-GCM. `owner` is bound as associated data, so a ciphertext copied
// onto another user's row fails to decrypt.
export function seal(plaintext: string, owner: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(owner));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), auth_tag: cipher.getAuthTag().toString("base64") };
}

export function unseal(sealed: Sealed, owner: string): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(Buffer.from(owner));
  decipher.setAuthTag(Buffer.from(sealed.auth_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
