import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// scrypt with OWASP-recommended cost; parameters are stored with each hash so they can be raised later.
const N = 2 ** 17;
const r = 8;
const p = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 256 * 1024 * 1024;

/** Minimum rules for a password; checked on the server for every password that is set. */
export const PASSWORD_MIN_LENGTH = 10;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: MAX_MEMORY,
  });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, n, rr, pp, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !n || !rr || !pp || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scryptAsync(
    password,
    Buffer.from(salt, "base64"),
    expected.length,
    { N: Number(n), r: Number(rr), p: Number(pp), maxmem: MAX_MEMORY },
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A real hash of a random password, used so unknown emails take as long to check as real ones.
let dummyHash: Promise<string> | undefined;
export function timingDummyHash() {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}
