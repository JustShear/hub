import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

// Stored as "salt:hash", both hex — no external dependency, no native binary.
export async function hashPassword(plainTextPassword: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(plainTextPassword, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  plainTextPassword: string,
  storedHash: string,
): Promise<boolean> {
  const [salt, hashHex] = storedHash.split(":");
  if (!salt || !hashHex) {
    return false;
  }

  const derivedKey = (await scryptAsync(plainTextPassword, salt, KEY_LENGTH)) as Buffer;
  const storedKey = Buffer.from(hashHex, "hex");

  if (storedKey.length !== derivedKey.length) {
    return false;
  }

  return timingSafeEqual(storedKey, derivedKey);
}
