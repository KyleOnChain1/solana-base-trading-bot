import Database from 'better-sqlite3';
import { Network } from '../types';
import { UserSecurity, WithdrawalWhitelist } from '../types/security';

let db: Database.Database;

/**
 * Initialize security tables
 * Call this after initDatabase()
 */
export function initSecurityTables(database: Database.Database): void {
  db = database;

  db.exec(`
    -- User security settings
    CREATE TABLE IF NOT EXISTS user_security (
      telegram_user_id INTEGER PRIMARY KEY,
      password_hash TEXT NOT NULL,
      anti_phishing_code TEXT,
      transfer_limit_sol REAL DEFAULT 1.0,
      transfer_limit_eth REAL DEFAULT 0.1,
      two_factor_secret TEXT,
      two_factor_enabled INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_password_change TEXT
    );

    -- Withdrawal address whitelist
    CREATE TABLE IF NOT EXISTS withdrawal_whitelist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER NOT NULL,
      network TEXT NOT NULL,
      address TEXT NOT NULL,
      label TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(telegram_user_id, network, address)
    );

    -- Failed login attempts (for rate limiting)
    CREATE TABLE IF NOT EXISTS login_attempts (
      telegram_user_id INTEGER NOT NULL,
      attempt_time INTEGER NOT NULL,
      success INTEGER NOT NULL
    );

    -- Security audit log
    CREATE TABLE IF NOT EXISTS security_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      ip_hint TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_whitelist_user ON withdrawal_whitelist(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_security_log_user ON security_log(telegram_user_id);
  `);

  // Try adding encryption_version column separately (SQLite doesn't have IF NOT EXISTS for ALTER)
  try {
    db.exec(`ALTER TABLE wallets ADD COLUMN encryption_version INTEGER DEFAULT 1;`);
  } catch {
    // Column already exists
  }
}

// ========== User Security ==========

/**
 * Check if user has set up security (has a password)
 */
export function hasUserSecurity(telegramUserId: number): boolean {
  const row = db.prepare(`
    SELECT 1 FROM user_security WHERE telegram_user_id = ?
  `).get(telegramUserId);
  return !!row;
}

/**
 * Get user security settings
 */
export function getUserSecurity(telegramUserId: number): UserSecurity | null {
  const row = db.prepare(`
    SELECT * FROM user_security WHERE telegram_user_id = ?
  `).get(telegramUserId) as any;

  if (!row) return null;

  return {
    telegramUserId: row.telegram_user_id,
    passwordHash: row.password_hash,
    antiPhishingCode: row.anti_phishing_code,
    transferLimitSol: row.transfer_limit_sol,
    transferLimitEth: row.transfer_limit_eth,
    twoFactorSecret: row.two_factor_secret,
    twoFactorEnabled: !!row.two_factor_enabled,
    createdAt: row.created_at,
    lastPasswordChange: row.last_password_change,
  };
}

/**
 * Create user security record
 */
export function createUserSecurity(
  telegramUserId: number,
  passwordHash: string
): void {
  db.prepare(`
    INSERT INTO user_security (telegram_user_id, password_hash)
    VALUES (?, ?)
  `).run(telegramUserId, passwordHash);
}

/**
 * Update user security settings
 */
export function updateUserSecurity(
  telegramUserId: number,
  updates: Partial<Omit<UserSecurity, 'telegramUserId' | 'createdAt'>>
): void {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.passwordHash !== undefined) {
    fields.push('password_hash = ?');
    values.push(updates.passwordHash);
    fields.push('last_password_change = CURRENT_TIMESTAMP');
  }
  if (updates.antiPhishingCode !== undefined) {
    fields.push('anti_phishing_code = ?');
    values.push(updates.antiPhishingCode);
  }
  if (updates.transferLimitSol !== undefined) {
    fields.push('transfer_limit_sol = ?');
    values.push(updates.transferLimitSol);
  }
  if (updates.transferLimitEth !== undefined) {
    fields.push('transfer_limit_eth = ?');
    values.push(updates.transferLimitEth);
  }
  if (updates.twoFactorSecret !== undefined) {
    fields.push('two_factor_secret = ?');
    values.push(updates.twoFactorSecret);
  }
  if (updates.twoFactorEnabled !== undefined) {
    fields.push('two_factor_enabled = ?');
    values.push(updates.twoFactorEnabled ? 1 : 0);
  }

  if (fields.length === 0) return;

  values.push(telegramUserId);
  db.prepare(`
    UPDATE user_security SET ${fields.join(', ')} WHERE telegram_user_id = ?
  `).run(...values);
}

// ========== Whitelist ==========

/**
 * Get all whitelisted addresses for a user
 */
export function getWhitelist(
  telegramUserId: number,
  network?: Network
): WithdrawalWhitelist[] {
  let query = `SELECT * FROM withdrawal_whitelist WHERE telegram_user_id = ?`;
  const params: any[] = [telegramUserId];

  if (network) {
    query += ` AND network = ?`;
    params.push(network);
  }

  return db.prepare(query).all(...params) as WithdrawalWhitelist[];
}

/**
 * Check if address is whitelisted
 */
export function isAddressWhitelisted(
  telegramUserId: number,
  network: Network,
  address: string
): boolean {
  const row = db.prepare(`
    SELECT 1 FROM withdrawal_whitelist 
    WHERE telegram_user_id = ? AND network = ? AND LOWER(address) = LOWER(?)
  `).get(telegramUserId, network, address);
  return !!row;
}

/**
 * Add address to whitelist
 */
export function addToWhitelist(
  telegramUserId: number,
  network: Network,
  address: string,
  label?: string
): void {
  db.prepare(`
    INSERT OR REPLACE INTO withdrawal_whitelist (telegram_user_id, network, address, label)
    VALUES (?, ?, ?, ?)
  `).run(telegramUserId, network, address, label || null);
}

/**
 * Remove address from whitelist
 */
export function removeFromWhitelist(
  telegramUserId: number,
  network: Network,
  address: string
): boolean {
  const result = db.prepare(`
    DELETE FROM withdrawal_whitelist 
    WHERE telegram_user_id = ? AND network = ? AND LOWER(address) = LOWER(?)
  `).run(telegramUserId, network, address);
  return result.changes > 0;
}

// ========== Login Attempts (Rate Limiting) ==========

/**
 * Record a login attempt
 */
export function recordLoginAttempt(
  telegramUserId: number,
  success: boolean
): void {
  db.prepare(`
    INSERT INTO login_attempts (telegram_user_id, attempt_time, success)
    VALUES (?, ?, ?)
  `).run(telegramUserId, Date.now(), success ? 1 : 0);

  // Clean up old attempts (older than 24 hours)
  db.prepare(`
    DELETE FROM login_attempts 
    WHERE telegram_user_id = ? AND attempt_time < ?
  `).run(telegramUserId, Date.now() - 24 * 60 * 60 * 1000);
}

/**
 * Get failed attempt count in last N minutes
 */
export function getFailedAttemptCount(
  telegramUserId: number,
  minutes: number = 15
): number {
  const since = Date.now() - minutes * 60 * 1000;
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM login_attempts 
    WHERE telegram_user_id = ? AND attempt_time > ? AND success = 0
  `).get(telegramUserId, since) as any;
  return row?.count || 0;
}

/**
 * Check if user is locked out
 */
export function isLockedOut(telegramUserId: number): {
  locked: boolean;
  unlockIn: number;
} {
  const failedCount = getFailedAttemptCount(telegramUserId, 15);

  // Lock after 5 failed attempts for 15 minutes
  if (failedCount >= 5) {
    // Find most recent failed attempt
    const row = db.prepare(`
      SELECT MAX(attempt_time) as last_attempt FROM login_attempts 
      WHERE telegram_user_id = ? AND success = 0
    `).get(telegramUserId) as any;

    const lockUntil = (row?.last_attempt || 0) + 15 * 60 * 1000;
    const now = Date.now();

    if (now < lockUntil) {
      return { locked: true, unlockIn: Math.ceil((lockUntil - now) / 60000) };
    }
  }

  return { locked: false, unlockIn: 0 };
}

// ========== Security Log ==========

/**
 * Log a security event
 */
export function logSecurityEvent(
  telegramUserId: number,
  action: string,
  details?: string
): void {
  db.prepare(`
    INSERT INTO security_log (telegram_user_id, action, details)
    VALUES (?, ?, ?)
  `).run(telegramUserId, action, details || null);
}

/**
 * Get recent security events
 */
export function getSecurityLog(
  telegramUserId: number,
  limit: number = 20
): any[] {
  return db.prepare(`
    SELECT * FROM security_log 
    WHERE telegram_user_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(telegramUserId, limit);
}

// ========== Wallet Encryption Version ==========

/**
 * Mark wallet as using new encryption
 */
export function setWalletEncryptionVersion(
  telegramUserId: number,
  network: Network,
  version: number
): void {
  db.prepare(`
    UPDATE wallets SET encryption_version = ? 
    WHERE telegram_user_id = ? AND network = ?
  `).run(version, telegramUserId, network);
}

/**
 * Get wallet encryption version
 */
export function getWalletEncryptionVersion(
  telegramUserId: number,
  network: Network
): number {
  const row = db.prepare(`
    SELECT encryption_version FROM wallets 
    WHERE telegram_user_id = ? AND network = ?
  `).get(telegramUserId, network) as any;
  return row?.encryption_version || 1;
}
