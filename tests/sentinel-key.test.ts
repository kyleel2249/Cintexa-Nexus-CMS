import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomInt, shuffle } from "../artifacts/cintexa/src/lib/sentinel-key/random";
import { generatePassword, generatePasswords, hasRepeat, hasSequence, passwordEntropyBits, DEFAULT_PASSWORD_OPTIONS, validatePasswordOptions } from "../artifacts/cintexa/src/lib/sentinel-key/password";
import { generatePassphrase, passphraseEntropyBits } from "../artifacts/cintexa/src/lib/sentinel-key/passphrase";
import { EFF_LARGE_WORDLIST } from "../artifacts/cintexa/src/lib/sentinel-key/wordlist";
import { generateRandomId, generateToken, generateUnique, isUuid, ulid, uuidv4, uuidv5, uuidv7, UUID_NAMESPACES } from "../artifacts/cintexa/src/lib/sentinel-key/ids";
import { generateRecoveryCodes, DEFAULT_RECOVERY_OPTIONS } from "../artifacts/cintexa/src/lib/sentinel-key/recovery";
import { analyzePassword, auditEntries } from "../artifacts/cintexa/src/lib/sentinel-key/analysis";
import { analyzeUrl, punycodeDecode } from "../artifacts/cintexa/src/lib/sentinel-key/url-check";
import { matchRange, sha1Hex, checkPwned } from "../artifacts/cintexa/src/lib/sentinel-key/breach";
import { changeMasterPassword, createVault, deleteVault, exportBackup, importBackup, saveVault, unlockVault, VaultError, VAULT_STORAGE_KEY, type KeyValueStore } from "../artifacts/cintexa/src/lib/sentinel-key/vault";

const memStore = (): KeyValueStore & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) }; };
const FAST = 200_000; // the accepted minimum; production creates vaults with 600,000

describe("secure randomness", () => {
  test("randomInt stays in range and is roughly uniform", () => {
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 12000; i++) counts[randomInt(6)]++;
    for (const c of counts) expect(c).toBeGreaterThan(1700);
    expect(() => randomInt(0)).toThrow();
  });
  test("shuffle keeps the same elements", () => expect(shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]));
  test("source never uses Math.random", () => {
    const dir = join(import.meta.dir, "../artifacts/cintexa/src/lib/sentinel-key");
    for (const f of (readdirSync(dir, { recursive: true }) as string[]).filter((x) => x.endsWith(".ts"))) expect(readFileSync(join(dir, f), "utf8").replace(/Math\.random\(\)\s*(is|\)|never)/g, "")).not.toMatch(/Math\.random\(\)/);
  });
});

describe("passwords", () => {
  test("honours length and every selected category", () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 12 }).value;
      expect(p.length).toBe(12);
      expect(p).toMatch(/[a-z]/); expect(p).toMatch(/[A-Z]/); expect(p).toMatch(/[0-9]/); expect(p).toMatch(/[^a-zA-Z0-9]/);
    }
  });
  test("excludes ambiguous and excluded characters", () => {
    for (let i = 0; i < 100; i++) expect(generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, excludeAmbiguous: true, exclude: "aeiou" }).value).not.toMatch(/[Il1O0o|aeiou]/);
  });
  test("avoid repeats and sequences", () => {
    for (let i = 0; i < 100; i++) {
      const p = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 30, avoidRepeats: true, avoidSequences: true }).value;
      expect(hasRepeat(p)).toBe(false); expect(hasSequence(p)).toBe(false);
    }
  });
  test("validation and limits", () => {
    expect(validatePasswordOptions({ ...DEFAULT_PASSWORD_OPTIONS, length: 7 })).not.toBeNull();
    expect(validatePasswordOptions({ ...DEFAULT_PASSWORD_OPTIONS, length: 129 })).not.toBeNull();
    expect(validatePasswordOptions({ ...DEFAULT_PASSWORD_OPTIONS, lower: false, upper: false, digits: false, symbols: false })).not.toBeNull();
    expect(generatePasswords(DEFAULT_PASSWORD_OPTIONS, 9999).length).toBe(50);
  });
  test("custom character set only", () => {
    const p = generatePassword({ length: 20, custom: "xyz9", minPerCategory: 1 }).value;
    expect(p).toMatch(/^[xyz9]{20}$/);
  });
  test("entropy is derived from the pool", () => {
    const bits = passwordEntropyBits({ ...DEFAULT_PASSWORD_OPTIONS, length: 10, symbols: false, upper: false, digits: false });
    expect(bits).toBeCloseTo(10 * Math.log2(26), 5);
  });
});

describe("passphrases", () => {
  test("EFF list has 7776 unique words", () => expect(new Set(EFF_LARGE_WORDLIST).size).toBe(7776));
  test("word count, separator, entropy", () => {
    const o = { words: 6, separator: "-", casing: "lower" as const, includeNumber: false };
    const p = generatePassphrase(o);
    expect(p.value.split("-").length).toBe(6);
    expect(p.entropyBits).toBeCloseTo(6 * Math.log2(7776), 5);
    expect(passphraseEntropyBits({ ...o, includeNumber: true })).toBeGreaterThan(p.entropyBits);
    expect(() => generatePassphrase({ ...o, words: 2 })).toThrow();
  });
});

describe("identifiers", () => {
  test("uuid v4 / v7 / ulid formats", () => {
    expect(uuidv4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const v7 = uuidv7(1700000000000);
    expect(v7).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(v7.replace(/-/g, "").slice(0, 12), 16)).toBe(1700000000000);
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true);
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ulid(1000) < ulid(2000000)).toBe(true);
  });
  test("uuid v5 matches the RFC 9562 test vector", async () => {
    expect(await uuidv5("www.example.com", UUID_NAMESPACES.DNS)).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    await expect(uuidv5("x", "nope")).rejects.toThrow();
    expect(isUuid(await uuidv5("a", UUID_NAMESPACES.URL))).toBe(true);
  });
  test("random ids: affixes, charset, unique batches", () => {
    const id = generateRandomId({ length: 10, lower: true, digits: true, prefix: "usr_", suffix: "_x" });
    expect(id).toMatch(/^usr_[a-z0-9]{10}_x$/);
    const batch = generateUnique(() => generateRandomId({ length: 8, lower: true, digits: true }), 300);
    expect(new Set(batch).size).toBe(300);
    expect(generateUnique(() => uuidv4(), 9999).length).toBe(500);
    expect(() => generateUnique(() => "same", 5)).toThrow();
  });
  test("tokens", () => {
    expect(generateToken({ bytes: 32, encoding: "hex" }).value).toMatch(/^[0-9a-f]{64}$/);
    const t = generateToken({ bytes: 32, encoding: "base64url", prefix: "sk_" });
    expect(t.value).toMatch(/^sk_[A-Za-z0-9_-]{43}$/); expect(t.entropyBits).toBe(256);
    expect(() => generateToken({ bytes: 8, encoding: "hex" })).toThrow();
  });
  test("recovery codes are unique and formatted", () => {
    const codes = generateRecoveryCodes({ ...DEFAULT_RECOVERY_OPTIONS, count: 20 });
    expect(new Set(codes).size).toBe(20);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(() => generateRecoveryCodes({ count: 99, groups: 2, groupLength: 5 })).toThrow();
  });
});

describe("analysis and audit", () => {
  test("common and patterned passwords are weak; random ones are strong", () => {
    expect(analyzePassword("Password123!").level).toBeLessThanOrEqual(1);
    expect(analyzePassword("qwerty").level).toBe(0);
    expect(analyzePassword(generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 24 }).value).level).toBeGreaterThanOrEqual(3);
    expect(analyzePassword("").entropyBits).toBe(0);
  });
  test("audit flags reuse without returning secrets", () => {
    const r = auditEntries([{ id: "1", name: "A", password: "Same-Pw-1" }, { id: "2", name: "B", password: "Same-Pw-1" }, { id: "3", name: "C", password: "x9$Kq!2mZ#pL8vTn" }]);
    expect(r.reused.length).toBe(1);
    expect(JSON.stringify(r)).not.toContain("Same-Pw-1");
  });
});

describe("URL checker", () => {
  const ids = (u: string, e?: string) => analyzeUrl(u, e).findings.map((f) => f.id);
  test("never reports a site as safe", () => {
    const r = analyzeUrl("https://example.com/login");
    expect(r.verdict).toBe("no-red-flags");
    expect(JSON.stringify(r).toLowerCase()).not.toContain('"verdict":"safe"');
  });
  test("flags userinfo, IP, port, http, shorteners", () => {
    expect(ids("https://paypal.com@evil.example")).toContain("userinfo");
    expect(ids("http://192.168.0.1/login")).toEqual(expect.arrayContaining(["ip", "http"]));
    expect(ids("https://example.com:8443")).toContain("port");
    expect(ids("https://bit.ly/abc")).toContain("shortener");
  });
  test("flags lookalikes and brand misuse", () => {
    expect(ids("https://paypa1.com")).toContain("lookalike");
    expect(ids("https://paypal.com.account-verify.example")).toContain("brand-misuse");
    expect(analyzeUrl("https://paypal.com").findings.some((f) => f.id === "lookalike" || f.id === "brand-misuse")).toBe(false);
    expect(analyzeUrl("https://paypal.com.account-verify.example").verdict).toBe("high-risk");
  });
  test("punycode and mixed script", () => {
    expect(punycodeDecode("bcher-kva")).toBe("bücher");
    expect(ids("https://xn--pple-43d.com")).toEqual(expect.arrayContaining(["punycode", "mixed-script"]));
  });
  test("expected origin mismatch and match", () => {
    expect(ids("https://app.example.org", "https://example.com")).toContain("origin-mismatch");
    expect(ids("https://example.com/path", "https://example.com")).toContain("origin-match");
  });
  test("malformed and dangerous input", () => {
    for (const bad of ["", "   ", "http://", "a b c", "x".repeat(3000)]) expect(analyzeUrl(bad).verdict).toBe("invalid");
    expect(analyzeUrl("javascript:alert(1)").verdict).toBe("high-risk");
    expect(analyzeUrl("data:text/html,<script>alert(1)</script>").verdict).toBe("high-risk");
  });
});

describe("breach check (k-anonymity)", () => {
  test("SHA-1 vector and range matching", async () => {
    expect(await sha1Hex("password")).toBe("5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
    expect(matchRange("0018A45C4D1DEF81644B54AB7F969B88D65:3\r\nABC:0", "0018A45C4D1DEF81644B54AB7F969B88D65")).toEqual({ found: true, count: 3 });
    expect(matchRange("ABC:0", "ABC").found).toBe(false);
  });
  test("only the 5-character prefix is sent", async () => {
    let seen = "";
    const fake = (async (url: string) => { seen = url; return new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:9000\r\n"); }) as unknown as typeof fetch;
    const r = await checkPwned("password", fake);
    expect(seen.endsWith("/range/5BAA6")).toBe(true);
    expect(seen).not.toContain("1E4C9B93");
    expect(r).toEqual({ found: true, count: 9000 });
    await expect(checkPwned("x", (async () => new Response("", { status: 500 })) as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("encrypted vault", () => {
  const entry = { id: "e1", name: "Example", username: "james", password: "S3cret-Value-!!", origin: "https://example.com", category: "work", notes: "n", createdAt: 1, updatedAt: 1 };
  test("round trip, no plaintext at rest, fresh IV per save", async () => {
    const store = memStore();
    const s = await createVault("correct horse battery", store, FAST);
    s.data.entries.push(entry);
    await saveVault(s, store);
    const raw1 = store.m.get(VAULT_STORAGE_KEY)!;
    expect(raw1).not.toContain("S3cret"); expect(raw1).not.toContain("james");
    await saveVault(s, store);
    const raw2 = store.m.get(VAULT_STORAGE_KEY)!;
    expect(JSON.parse(raw1).cipher.iv).not.toBe(JSON.parse(raw2).cipher.iv);
    const re = await unlockVault("correct horse battery", store);
    expect(re.data.entries[0]).toEqual(entry);
  });
  test("wrong master password is rejected", async () => {
    const store = memStore(); await createVault("correct horse battery", store, FAST);
    await expect(unlockVault("wrong password here", store)).rejects.toMatchObject({ code: "wrong-password" });
  });
  test("corrupted ciphertext and tampered KDF metadata fail authentication", async () => {
    const store = memStore(); const s = await createVault("correct horse battery", store, FAST);
    s.data.entries.push(entry); await saveVault(s, store);
    const env = JSON.parse(store.m.get(VAULT_STORAGE_KEY)!);
    const bytes = Buffer.from(env.data, "base64"); bytes[3]! ^= 1;
    store.m.set(VAULT_STORAGE_KEY, JSON.stringify({ ...env, data: bytes.toString("base64") }));
    await expect(unlockVault("correct horse battery", store)).rejects.toBeInstanceOf(VaultError);
    store.m.set(VAULT_STORAGE_KEY, JSON.stringify({ ...env, kdf: { ...env.kdf, iterations: 250000 } }));
    await expect(unlockVault("correct horse battery", store)).rejects.toBeInstanceOf(VaultError);
  });
  test("weak master password and duplicate vault are refused", async () => {
    const store = memStore();
    await expect(createVault("short", store, FAST)).rejects.toMatchObject({ code: "weak-master" });
    await createVault("correct horse battery", store, FAST);
    await expect(createVault("another long master pw", store, FAST)).rejects.toBeInstanceOf(VaultError);
  });
  test("backup export/import and malicious files", async () => {
    const a = memStore(); const s = await createVault("correct horse battery", a, 250000);
    s.data.entries.push(entry); await saveVault(s, a);
    const backup = await exportBackup(s);
    expect(backup).not.toContain("S3cret");
    const b = memStore();
    const restored = await importBackup(backup, "correct horse battery", b);
    expect(restored.data.entries.length).toBe(1);
    expect(b.m.has(VAULT_STORAGE_KEY)).toBe(true);
    const c = memStore();
    await expect(importBackup(backup, "bad master pw!!!", c)).rejects.toBeInstanceOf(VaultError);
    expect(c.m.size).toBe(0);
    for (const bad of ["not json", "{}", '{"v":1}', "x".repeat(6 * 1024 * 1024), JSON.stringify({ ...JSON.parse(backup), kdf: { ...JSON.parse(backup).kdf, iterations: 1 } }), JSON.stringify({ ...JSON.parse(backup), kdf: { ...JSON.parse(backup).kdf, iterations: 9e9 } }), '{"__proto__":{"v":1}}']) {
      await expect(importBackup(bad, "correct horse battery", memStore())).rejects.toBeInstanceOf(VaultError);
    }
  });
  test("change master password re-encrypts with a new salt; delete removes vault", async () => {
    const store = memStore(); const s = await createVault("correct horse battery", store, FAST);
    s.data.entries.push(entry);
    const n = await changeMasterPassword(s, "a brand new master pw", store);
    expect(n.data.entries.length).toBe(1);
    await expect(unlockVault("correct horse battery", store)).rejects.toBeInstanceOf(VaultError);
    expect((await unlockVault("a brand new master pw", store)).data.entries.length).toBe(1);
    deleteVault(store); expect(store.m.size).toBe(0);
  });
});
