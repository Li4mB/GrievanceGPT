import crypto from "node:crypto";

import { appEnv } from "./env";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

const decodeEncryptionKey = (value: string): Buffer => {
  if (/^[a-fA-F0-9]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }

  const decoded = Buffer.from(value, "base64");

  if (decoded.length === 32) {
    return decoded;
  }

  throw new Error(
    "ENCRYPTION_KEY must be a 32-byte base64 string or 64-character hex string.",
  );
};

const encryptionKey = decodeEncryptionKey(appEnv.encryptionKey);

export const generateStateToken = (): string =>
  crypto.randomBytes(32).toString("hex");

export const encryptString = (plaintext: string): string => {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(
    ENCRYPTION_ALGORITHM,
    encryptionKey,
    iv,
  );

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
};

export const decryptString = (payload: string): string => {
  const [ivBase64, authTagBase64, ciphertextBase64] = payload.split(":");

  if (!ivBase64 || !authTagBase64 || !ciphertextBase64) {
    throw new Error("Invalid encrypted payload.");
  }

  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    encryptionKey,
    Buffer.from(ivBase64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
};

export const safeCompare = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const hmacSha256Hex = (secret: string, payload: string): string =>
  crypto.createHmac("sha256", secret).update(payload).digest("hex");

export const hmacSha256Base64 = (secret: string, payload: string): string =>
  crypto.createHmac("sha256", secret).update(payload).digest("base64");

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
