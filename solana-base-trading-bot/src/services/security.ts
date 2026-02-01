import { Network } from '../types';
import {
  encryptWithPassword,
  decryptWithPassword,
  hashPassword,
  verifyPassword,
  decryptLegacy,
  isLegacyFormat,
  generateSecurePassword,
} from '../utils/encryption';
import * as securityDb from './security-database';
import * as sessionManager from './session-manager';
import * as db from '../services/database';
import { config } from '../config';

// ========== Password Setup ==========

/**
 * Check if user needs to set up a password
 */
export function needsPasswordSetup(telegramUserId: number): boolean {
  return !securityDb.hasUserSecurity(telegramUserId);
}

/**
 * Set up initial password for a user
 */
export function setupPassword(
  telegramUserId: number,
  password: string
): { success: boolean; error?: string } {
  if (securityDb.hasUserSecurity(telegramUserId)) {
    return { success: false, error: 'Password already set up' };
  }

  if (password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters' };
  }

  const hash = hashPassword(password, telegramUserId);
  securityDb.createUserSecurity(telegramUserId, hash);
  securityDb.logSecurityEvent(telegramUserId, 'password_created');

  return { success: true };
}

/**
 * Change user password (requires current password)
 */
export function changePassword(
  telegramUserId: number,
  currentPassword: string,
  newPassword: string
): { success: boolean; error?: string } {
  const security = securityDb.getUserSecurity(telegramUserId);
  if (!security) {
    return { success: false, error: 'No security setup found' };
  }

  if (!verifyPassword(currentPassword, telegramUserId, security.passwordHash)) {
    securityDb.recordLoginAttempt(telegramUserId, false);
    return { success: false, error: 'Current password is incorrect' };
  }

  if (newPassword.length < 6) {
    return { success: false, error: 'New password must be at least 6 characters' };
  }

  // Re-encrypt all wallets with new password
  const wallets = db.getAllWallets(telegramUserId);
  for (const wallet of wallets) {
    const privateKey = decryptPrivateKey(telegramUserId, wallet.network, currentPassword);
    if (privateKey) {
      const newEncrypted = encryptWithPassword(privateKey, newPassword, telegramUserId);
      db.saveWallet(telegramUserId, wallet.network, wallet.address, newEncrypted);
      securityDb.setWalletEncryptionVersion(telegramUserId, wallet.network, 2);
    }
  }

  // Update password hash
  const newHash = hashPassword(newPassword, telegramUserId);
  securityDb.updateUserSecurity(telegramUserId, { passwordHash: newHash });
  securityDb.logSecurityEvent(telegramUserId, 'password_changed');

  // Invalidate session
  sessionManager.lockSession(telegramUserId);

  return { success: true };
}

// ========== Unlock / Lock ==========

/**
 * Attempt to unlock wallet with password
 */
export function unlock(
  telegramUserId: number,
  password: string
): { success: boolean; error?: string; lockoutMinutes?: number } {
  // Check lockout
  const lockout = securityDb.isLockedOut(telegramUserId);
  if (lockout.locked) {
    return {
      success: false,
      error: `Too many failed attempts. Try again in ${lockout.unlockIn} minutes.`,
      lockoutMinutes: lockout.unlockIn,
    };
  }

  const security = securityDb.getUserSecurity(telegramUserId);
  if (!security) {
    return { success: false, error: 'Please set up a password first with /security' };
  }

  // Verify password
  if (!verifyPassword(password, telegramUserId, security.passwordHash)) {
    securityDb.recordLoginAttempt(telegramUserId, false);
    const failedCount = securityDb.getFailedAttemptCount(telegramUserId, 15);
    const remaining = 5 - failedCount;
    return {
      success: false,
      error: remaining > 0
        ? `Incorrect password. ${remaining} attempts remaining.`
        : 'Account locked for 15 minutes due to too many failed attempts.',
    };
  }

  // Success - create session and decrypt keys
  securityDb.recordLoginAttempt(telegramUserId, true);
  const session = sessionManager.createSession(telegramUserId);

  // Decrypt and cache wallet keys
  const wallets = db.getAllWallets(telegramUserId);
  for (const wallet of wallets) {
    const privateKey = decryptPrivateKey(telegramUserId, wallet.network, password);
    if (privateKey) {
      sessionManager.storeKeyInSession(telegramUserId, wallet.network, privateKey);
    }
  }

  securityDb.logSecurityEvent(telegramUserId, 'unlock');
  return { success: true };
}

/**
 * Lock wallet (end session)
 */
export function lock(telegramUserId: number): void {
  sessionManager.lockSession(telegramUserId);
  securityDb.logSecurityEvent(telegramUserId, 'lock');
}

/**
 * Check if wallet is unlocked
 */
export function isUnlocked(telegramUserId: number): boolean {
  return sessionManager.getSession(telegramUserId) !== null;
}

// ========== Private Key Operations ==========

/**
 * Decrypt a private key (handles both legacy and new format)
 */
function decryptPrivateKey(
  telegramUserId: number,
  network: Network,
  password: string
): string | null {
  const wallet = db.getWallet(telegramUserId, network);
  if (!wallet) return null;

  // Check encryption version
  const version = securityDb.getWalletEncryptionVersion(telegramUserId, network);

  if (version === 1 && isLegacyFormat(wallet.encryptedPrivateKey)) {
    // Legacy format - use server key
    return decryptLegacy(wallet.encryptedPrivateKey, config.walletEncryptionKey);
  }

  // New format - use user password
  return decryptWithPassword(wallet.encryptedPrivateKey, password, telegramUserId);
}

/**
 * Get decrypted private key (requires unlocked session)
 */
export function getPrivateKey(
  telegramUserId: number,
  network: Network
): string | null {
  return sessionManager.getKeyFromSession(telegramUserId, network);
}

/**
 * Encrypt and save a new wallet with user's password
 */
export function saveEncryptedWallet(
  telegramUserId: number,
  network: Network,
  address: string,
  privateKey: string,
  password: string
): void {
  const encrypted = encryptWithPassword(privateKey, password, telegramUserId);
  db.saveWallet(telegramUserId, network, address, encrypted);
  securityDb.setWalletEncryptionVersion(telegramUserId, network, 2);

  // Cache in session if unlocked
  if (isUnlocked(telegramUserId)) {
    sessionManager.storeKeyInSession(telegramUserId, network, privateKey);
  }
}

// ========== Security Checks ==========

/**
 * Check if a withdraw requires password confirmation
 */
export function requiresPasswordForWithdraw(
  telegramUserId: number,
  network: Network,
  toAddress: string,
  amount: number
): boolean {
  // Always require password if session expired
  if (!isUnlocked(telegramUserId)) return true;

  // Check whitelist
  if (securityDb.isAddressWhitelisted(telegramUserId, network, toAddress)) {
    return false; // Whitelisted addresses don't need extra confirmation
  }

  // Check transfer limits
  const security = securityDb.getUserSecurity(telegramUserId);
  if (!security) return true;

  const limit = network === 'solana'
    ? security.transferLimitSol || 1.0
    : security.transferLimitEth || 0.1;

  return amount > limit;
}

/**
 * Verify password for a secure action (without creating session)
 */
export function verifyPasswordForAction(
  telegramUserId: number,
  password: string
): boolean {
  const security = securityDb.getUserSecurity(telegramUserId);
  if (!security) return false;

  const valid = verifyPassword(password, telegramUserId, security.passwordHash);
  securityDb.recordLoginAttempt(telegramUserId, valid);
  return valid;
}

// ========== Migration ==========

/**
 * Migrate a legacy wallet to new encryption
 * Requires user to provide new password
 */
export function migrateWallet(
  telegramUserId: number,
  network: Network,
  newPassword: string
): { success: boolean; error?: string } {
  const wallet = db.getWallet(telegramUserId, network);
  if (!wallet) {
    return { success: false, error: 'Wallet not found' };
  }

  const version = securityDb.getWalletEncryptionVersion(telegramUserId, network);
  if (version >= 2) {
    return { success: false, error: 'Wallet already using new encryption' };
  }

  // Decrypt with legacy key
  const privateKey = decryptLegacy(wallet.encryptedPrivateKey, config.walletEncryptionKey);
  if (!privateKey) {
    return { success: false, error: 'Failed to decrypt wallet' };
  }

  // Re-encrypt with user password
  const newEncrypted = encryptWithPassword(privateKey, newPassword, telegramUserId);
  db.saveWallet(telegramUserId, network, wallet.address, newEncrypted);
  securityDb.setWalletEncryptionVersion(telegramUserId, network, 2);
  securityDb.logSecurityEvent(telegramUserId, 'wallet_migrated', network);

  return { success: true };
}

/**
 * Migrate all wallets for a user
 */
export function migrateAllWallets(
  telegramUserId: number,
  newPassword: string
): { success: boolean; migrated: Network[]; failed: Network[] } {
  const wallets = db.getAllWallets(telegramUserId);
  const migrated: Network[] = [];
  const failed: Network[] = [];

  for (const wallet of wallets) {
    const result = migrateWallet(telegramUserId, wallet.network, newPassword);
    if (result.success) {
      migrated.push(wallet.network);
    } else {
      failed.push(wallet.network);
    }
  }

  return { success: failed.length === 0, migrated, failed };
}

// ========== Anti-Phishing ==========

/**
 * Set anti-phishing code
 */
export function setAntiPhishingCode(
  telegramUserId: number,
  code: string
): void {
  securityDb.updateUserSecurity(telegramUserId, { antiPhishingCode: code });
  securityDb.logSecurityEvent(telegramUserId, 'anti_phishing_set');
}

/**
 * Get anti-phishing code
 */
export function getAntiPhishingCode(telegramUserId: number): string | null {
  const security = securityDb.getUserSecurity(telegramUserId);
  return security?.antiPhishingCode || null;
}

// ========== Transfer Limits ==========

/**
 * Set transfer limits
 */
export function setTransferLimits(
  telegramUserId: number,
  limitSol?: number,
  limitEth?: number
): void {
  securityDb.updateUserSecurity(telegramUserId, {
    transferLimitSol: limitSol,
    transferLimitEth: limitEth,
  });
  securityDb.logSecurityEvent(telegramUserId, 'limits_changed');
}

// ========== Utilities ==========

export { generateSecurePassword };
export { getWhitelist, addToWhitelist, removeFromWhitelist, isAddressWhitelisted } from './security-database';
export { getSessionInfo, getSessionTimeRemaining, refreshSession } from './session-manager';

/**
 * Create and encrypt a new wallet (requires valid password)
 * This is used for new wallet creation flow
 */
export function createEncryptedWallet(
  telegramUserId: number,
  network: Network,
  address: string,
  privateKey: string,
  password: string
): { success: boolean; error?: string } {
  // Verify password is correct first
  const security = securityDb.getUserSecurity(telegramUserId);
  if (!security) {
    return { success: false, error: 'Please set up security first with /security' };
  }

  if (!verifyPassword(password, telegramUserId, security.passwordHash)) {
    return { success: false, error: 'Incorrect password' };
  }

  // Encrypt and save
  const encrypted = encryptWithPassword(privateKey, password, telegramUserId);
  db.saveWallet(telegramUserId, network, address, encrypted);
  securityDb.setWalletEncryptionVersion(telegramUserId, network, 2);
  securityDb.logSecurityEvent(telegramUserId, 'wallet_created', network);

  // Cache in session if unlocked
  if (isUnlocked(telegramUserId)) {
    sessionManager.storeKeyInSession(telegramUserId, network, privateKey);
  }

  return { success: true };
}
