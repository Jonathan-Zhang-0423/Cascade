import * as OTPAuth from "otpauth";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { encryptTotpSecret, decryptTotpSecret } from "./admin-auth.js";

// ── TOTP Configuration ────────────────────────────────────────────────────────
const TOTP_ISSUER = "CascadeAI Admin";
const TOTP_ALGORITHM = "SHA1";
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const TOTP_WINDOW = 1; // Allow 1 step drift (±30s)

// ── Backup Codes ──────────────────────────────────────────────────────────────
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 8;
const BACKUP_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Unambiguous

// ── TOTP Secret Generation ────────────────────────────────────────────────────
export function generateTotpSecret(username: string): {
  secret: string;       // plain base32 secret (show only during setup)
  encryptedSecret: string; // for DB storage
  uri: string;          // otpauth:// URI for QR code
} {
  // Generate 20-byte random secret
  const secretBytes = crypto.randomBytes(20);
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: username,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromHex(secretBytes.toString("hex")),
  });

  const base32Secret = totp.secret.base32;
  const encryptedSecret = encryptTotpSecret(base32Secret);
  const uri = totp.toString();

  return { secret: base32Secret, encryptedSecret, uri };
}

// ── TOTP Verification ─────────────────────────────────────────────────────────
export function verifyTotpCode(encryptedSecret: string, code: string): boolean {
  try {
    const base32Secret = decryptTotpSecret(encryptedSecret);
    const totp = new OTPAuth.TOTP({
      issuer: TOTP_ISSUER,
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
      secret: OTPAuth.Secret.fromBase32(base32Secret),
    });
    // validate returns the time step difference or null if invalid
    const delta = totp.validate({ token: code, window: TOTP_WINDOW });
    return delta !== null;
  } catch {
    return false;
  }
}

// ── Backup Codes ──────────────────────────────────────────────────────────────
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    let code = "";
    const bytes = crypto.randomBytes(BACKUP_CODE_LENGTH);
    for (let j = 0; j < BACKUP_CODE_LENGTH; j++) {
      code += BACKUP_CODE_CHARSET[bytes[j] % BACKUP_CODE_CHARSET.length];
    }
    codes.push(code);
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]): Promise<string> {
  const hashes = await Promise.all(
    codes.map((code) => bcrypt.hash(code.toUpperCase(), 10))
  );
  // Store as JSON array; each entry: { hash, used: false }
  return JSON.stringify(hashes.map((hash) => ({ hash, used: false })));
}

export async function verifyBackupCode(
  code: string,
  backupCodesJson: string
): Promise<{ valid: boolean; updatedJson: string }> {
  const entries: { hash: string; used: boolean }[] = JSON.parse(backupCodesJson);
  const normalizedCode = code.toUpperCase();

  for (let i = 0; i < entries.length; i++) {
    if (entries[i].used) continue;
    const match = await bcrypt.compare(normalizedCode, entries[i].hash);
    if (match) {
      entries[i].used = true;
      return { valid: true, updatedJson: JSON.stringify(entries) };
    }
  }
  return { valid: false, updatedJson: backupCodesJson };
}
