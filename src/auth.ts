import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export function hashPass(pass: string, salt = randomBytes(16).toString("hex")): { hash: string; salt: string } {
  const hash = scryptSync(pass, salt, 32).toString("hex");
  return { hash, salt };
}

export function checkPass(pass: string, salt: string, hash: string): boolean {
  try {
    const h = scryptSync(pass, salt, 32);
    const ref = Buffer.from(hash, "hex");
    return h.length === ref.length && timingSafeEqual(h, ref);
  } catch {
    return false;
  }
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
