/**
 * Client-side encryption for the Sentinel Key store. The server / on-device database only ever sees ciphertext.
 *  - Key: PBKDF2-HMAC-SHA-256 (600,000 iterations, random 16-byte salt) -> non-extractable AES-256-GCM key.
 *  - Each secret: fresh random 96-bit IV; additional authenticated data binds the ciphertext to its record id and type,
 *    so a ciphertext cannot be swapped between records without failing authentication.
 *  - A "verifier" (a known string encrypted with the key) lets us reject a wrong master password without storing it.
 */
import { fromBase64, getCrypto, randomBytes, toBase64 } from "../random";

export const KDF_ITERATIONS = 600_000;
export const ENC_VERSION = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();
const VERIFIER_TEXT = "sentinel-key-verifier-v1";

export interface KdfParams { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string }
export interface Sealed { iv: string; ciphertext: string }
export const aadFor = (recordId: string, type: string) => enc.encode(`sk${ENC_VERSION}|${type}|${recordId}`);

export async function deriveKey(master: string, kdf: KdfParams): Promise<CryptoKey> {
  const s = getCrypto().subtle;
  const base = await s.importKey("raw", enc.encode(master.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return s.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: fromBase64(kdf.salt) as BufferSource, iterations: kdf.iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function newKdf(iterations = KDF_ITERATIONS): KdfParams { return { name: "PBKDF2", hash: "SHA-256", iterations, salt: toBase64(randomBytes(16)) }; }

export async function seal(key: CryptoKey, plaintext: string, aad: Uint8Array): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await getCrypto().subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource }, key, enc.encode(plaintext));
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ct)) };
}

export async function open(key: CryptoKey, sealed: Sealed, aad: Uint8Array): Promise<string> {
  const pt = await getCrypto().subtle.decrypt({ name: "AES-GCM", iv: fromBase64(sealed.iv) as BufferSource, additionalData: aad as BufferSource }, key, fromBase64(sealed.ciphertext) as BufferSource);
  return dec.decode(pt);
}

export async function makeVerifier(key: CryptoKey): Promise<{ verifierIv: string; verifierCt: string }> {
  const s = await seal(key, VERIFIER_TEXT, enc.encode("verifier"));
  return { verifierIv: s.iv, verifierCt: s.ciphertext };
}
export async function checkVerifier(key: CryptoKey, verifierIv: string, verifierCt: string): Promise<boolean> {
  try { return (await open(key, { iv: verifierIv, ciphertext: verifierCt }, enc.encode("verifier"))) === VERIFIER_TEXT; } catch { return false; }
}
