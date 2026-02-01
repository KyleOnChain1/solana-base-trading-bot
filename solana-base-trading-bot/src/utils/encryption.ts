import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm'; // GCM provides authentication (better than CBC)
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 310000; // OWASP 2023 recommendation for SHA-256

/**
 * Derive an encryption key from user password + telegram ID
 * This ensures each user has a unique key that only THEY can recreate
 */
export function deriveKeyFromPassword(
  password: string,
  telegramUserId: number,
  salt: Buffer
): Buffer {
  // Combine password with telegram ID for additional uniqueness
  const combined = `${password}:${telegramUserId}`;
  return crypto.pbkdf2Sync(combined, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Hash password for storage (to verify without storing plaintext)
 * Uses Argon2-like approach with PBKDF2
 */
export function hashPassword(password: string, telegramUserId: number): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const hash = crypto.pbkdf2Sync(
    `${password}:${telegramUserId}`,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha256'
  );
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Verify a password against stored hash
 */
export function verifyPassword(
  password: string,
  telegramUserId: number,
  storedHash: string
): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;

  const salt = Buffer.from(parts[0], 'hex');
  const hash = Buffer.from(parts[1], 'hex');

  const testHash = crypto.pbkdf2Sync(
    `${password}:${telegramUserId}`,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha256'
  );

  return crypto.timingSafeEqual(hash, testHash);
}

/**
 * Encrypt private key with user's password-derived key
 * Format: salt:iv:authTag:encryptedData (all hex)
 */
export function encryptWithPassword(
  plaintext: string,
  password: string,
  telegramUserId: number
): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKeyFromPassword(password, telegramUserId, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return [
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted,
  ].join(':');
}

/**
 * Decrypt private key with user's password
 * Returns null if password is wrong (authentication fails)
 */
export function decryptWithPassword(
  encryptedText: string,
  password: string,
  telegramUserId: number
): string | null {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 4) return null;

    const salt = Buffer.from(parts[0], 'hex');
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const encrypted = parts[3];

    const key = deriveKeyFromPassword(password, telegramUserId, salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // Authentication failed (wrong password) or corrupted data
    return null;
  }
}

/**
 * Generate a secure random password suggestion
 */
export function generateSecurePassword(): string {
  // Generate 6 random words from a simple wordlist approach
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 4; i++) {
    let word = '';
    for (let j = 0; j < 4; j++) {
      word += chars[crypto.randomInt(chars.length)];
    }
    password += (i > 0 ? '-' : '') + word;
  }
  return password;
}

/**
 * Encrypt data with a one-time session key (for temporary unlocks)
 * Uses random key stored only in memory
 */
export function createSessionEncryption(): {
  encrypt: (data: string) => string;
  decrypt: (encrypted: string) => string | null;
} {
  const sessionKey = crypto.randomBytes(KEY_LENGTH);

  return {
    encrypt: (data: string): string => {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, sessionKey, iv);
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    },
    decrypt: (encryptedText: string): string | null => {
      try {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) return null;
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        const decipher = crypto.createDecipheriv(ALGORITHM, sessionKey, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
      } catch {
        return null;
      }
    },
  };
}

// ========== Legacy support for migration ==========
// These functions handle the OLD encryption format during migration

const LEGACY_ALGORITHM = 'aes-256-cbc';
const LEGACY_IV_LENGTH = 16;

/**
 * Decrypt using the OLD server-key method (for migration only)
 */
export function decryptLegacy(encryptedText: string, serverKey: string): string | null {
  try {
    const key = Buffer.from(serverKey, 'hex');
    const parts = encryptedText.split(':');
    if (parts.length !== 2) return null;

    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];

    const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Check if encrypted text is in legacy format
 */
export function isLegacyFormat(encryptedText: string): boolean {
  const parts = encryptedText.split(':');
  // Legacy: iv:encrypted (2 parts)
  // New: salt:iv:authTag:encrypted (4 parts)
  return parts.length === 2;
}
