import { createHash } from 'node:crypto';

// Password hashing is performed with Web Crypto in the Worker runtime.
// PBKDF2 is intentionally used here because it is available natively in Workers.
const ITERATIONS = 210_000;
const HASH_ALG = 'SHA-256';

const bytesToHex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) ?? []);

export async function hashPassword(password: string, saltHex?: string) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: HASH_ALG }, key, 256);
  return `pbkdf2:${ITERATIONS}:${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [scheme, iterations, saltHex, expected] = encoded.split(':');
  if (scheme !== 'pbkdf2' || !iterations || !saltHex || !expected) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: Number(iterations), hash: HASH_ALG }, key, 256);
  const actual = bytesToHex(new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function createSessionToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function sessionCookie(token: string) {
  return `aryavoipe_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;
}

export function clearSessionCookie() {
  return 'aryavoipe_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}
