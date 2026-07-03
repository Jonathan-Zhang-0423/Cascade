import jwt from "jsonwebtoken";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

// ── Config ────────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.ADMIN_JWT_SECRET || "dev-admin-jwt-secret-change-me";
const TOTP_ENCRYPTION_KEY = process.env.ADMIN_TOTP_ENCRYPTION_KEY || "0".repeat(64);
const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";
const TEMP_TOKEN_EXPIRY = "5m";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AdminTokenPayload {
  sub: string;        // admin user ID
  username: string;
  role: string;
  jti: string;        // unique token ID for blacklisting
  type: "access" | "refresh" | "temp";
}

declare global {
  namespace Express {
    interface Request {
      adminUser?: AdminTokenPayload;
    }
  }
}

// ── Token Blacklist (in-memory) ───────────────────────────────────────────────
// Access tokens are short-lived (15 min), so in-memory is acceptable for
// single-server. On restart, all blacklisted tokens are cleared — fine because
// they would have expired anyway within 15 minutes.
const tokenBlacklist = new Set<string>();

export function blacklistToken(jti: string): void {
  tokenBlacklist.add(jti);
  // Auto-cleanup after 15 minutes (access token max lifetime)
  setTimeout(() => tokenBlacklist.delete(jti), 15 * 60 * 1000).unref();
}

export function isBlacklisted(jti: string): boolean {
  return tokenBlacklist.has(jti);
}

// ── JWT Helpers ───────────────────────────────────────────────────────────────
function generateJti(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function signAccessToken(payload: Omit<AdminTokenPayload, "jti" | "type">): string {
  const jti = generateJti();
  return jwt.sign({ ...payload, jti, type: "access" }, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

export function signRefreshToken(payload: Omit<AdminTokenPayload, "jti" | "type">): string {
  const jti = generateJti();
  return jwt.sign({ ...payload, jti, type: "refresh" }, JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

export function signTempToken(payload: Omit<AdminTokenPayload, "jti" | "type">): string {
  const jti = generateJti();
  return jwt.sign({ ...payload, jti, type: "temp" }, JWT_SECRET, {
    expiresIn: TEMP_TOKEN_EXPIRY,
  });
}

export function verifyToken(token: string, expectedType: AdminTokenPayload["type"]): AdminTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AdminTokenPayload;
    if (decoded.type !== expectedType) return null;
    if (isBlacklisted(decoded.jti)) return null;
    return decoded;
  } catch {
    return null;
  }
}

// ── AES-256-GCM Encryption (for TOTP secrets at rest) ─────────────────────────
function getEncryptionKey(): Buffer {
  return Buffer.from(TOTP_ENCRYPTION_KEY, "hex");
}

export function encryptTotpSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store as iv:authTag:ciphertext (all base64)
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptTotpSecret(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, encB64] = ciphertext.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const encrypted = Buffer.from(encB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

// ── Admin Auth Middleware ─────────────────────────────────────────────────────
// Non-blocking: sets req.adminUser if a valid JWT exists in the cookie,
// but does NOT return 401. The downstream `checkAdmin()` decides whether to
// allow or deny based on the presence of req.adminUser + fallback logic.
export function adminAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.admin_access;
  if (token) {
    const payload = verifyToken(token, "access");
    if (payload) {
      req.adminUser = payload;
    }
  }
  next();
}

// ── Cookie Helpers ────────────────────────────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === "production";

export function setAccessTokenCookie(res: Response, token: string): void {
  res.cookie("admin_access", token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "strict",
    path: "/",
    maxAge: 15 * 60 * 1000, // 15 minutes
  });
}

export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie("admin_refresh", token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "strict",
    path: "/api/admin/auth/refresh",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

export function clearAdminCookies(res: Response): void {
  res.clearCookie("admin_access", { path: "/" });
  res.clearCookie("admin_refresh", { path: "/api/admin/auth/refresh" });
}
