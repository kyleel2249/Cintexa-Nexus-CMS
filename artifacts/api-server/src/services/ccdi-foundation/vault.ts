/**
 * CCDI foundation — credential vault primitives (AES-256-GCM envelope).
 *
 * Keys come ONLY from the environment (or an external secrets manager that
 * injects them as environment variables):
 *   CCDI_MASTER_KEYS = "1:<base64 32 bytes>,2:<base64 32 bytes>"   (highest version encrypts)
 *   CCDI_MASTER_KEY  = "<base64 32 bytes>"                          (shorthand for version 1)
 *
 * Generate a key:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * When no key is configured the vault reports `configured: false` and refuses to
 * store secrets. It never falls back to a hardcoded or ephemeral key.
 * Production-grade external secret storage (KMS / Vault) is NOT active; this is the
 * documented application-level encryption foundation.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

function loadKeys(): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  const add = (version: number, b64: string) => {
    const buf = Buffer.from(b64.trim(), "base64");
    if (buf.length === 32 && Number.isInteger(version) && version > 0) keys.set(version, buf);
  };
  const multi = process.env.CCDI_MASTER_KEYS;
  if (multi) {
    for (const part of multi.split(",")) {
      const idx = part.indexOf(":");
      if (idx > 0) add(Number.parseInt(part.slice(0, idx), 10), part.slice(idx + 1));
    }
  }
  if (process.env.CCDI_MASTER_KEY && !keys.has(1)) add(1, process.env.CCDI_MASTER_KEY);
  return keys;
}

export function vaultStatus(): { configured: boolean; activeKeyVersion: number | null; keyVersions: number[]; mode: string } {
  const keys = loadKeys();
  const versions = [...keys.keys()].sort((a, b) => a - b);
  return {
    configured: versions.length > 0,
    activeKeyVersion: versions.length ? versions[versions.length - 1] : null,
    keyVersions: versions,
    mode: "application-level AES-256-GCM (keys from environment); external KMS not configured",
  };
}

export function maskSecret(value: string): string {
  return value.length >= 12 ? `••••${value.slice(-4)}` : "••••";
}

/** `aad` binds the ciphertext to its row (credential id), so rows cannot be swapped. */
export function sealSecret(plaintext: string, aad: string): SealedSecret {
  const keys = loadKeys();
  if (!keys.size) throw new Error("VAULT_NOT_CONFIGURED");
  const keyVersion = Math.max(...keys.keys());
  const key = keys.get(keyVersion) as Buffer;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion,
  };
}

export function openSecret(sealed: SealedSecret, aad: string): string {
  const key = loadKeys().get(sealed.keyVersion);
  if (!key) throw new Error("VAULT_KEY_UNAVAILABLE");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** Only CCDI_-prefixed variables may be referenced, so a reference can never read arbitrary server env. */
export const ENV_REF_RE = /^CCDI_[A-Z0-9_]{1,80}$/;
