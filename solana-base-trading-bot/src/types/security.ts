import { Network } from './index';

/**
 * User security settings stored in database
 */
export interface UserSecurity {
  telegramUserId: number;
  passwordHash: string; // PBKDF2 hash of user's password
  antiPhishingCode?: string; // Secret word shown in all messages
  transferLimitSol?: number; // SOL amount that requires password
  transferLimitEth?: number; // ETH amount that requires password
  twoFactorSecret?: string; // TOTP secret (encrypted with user password)
  twoFactorEnabled: boolean;
  createdAt: string;
  lastPasswordChange?: string;
}

/**
 * Whitelisted withdrawal addresses
 */
export interface WithdrawalWhitelist {
  id: number;
  telegramUserId: number;
  network: Network;
  address: string;
  label?: string;
  createdAt: string;
}

/**
 * Active session for an unlocked wallet
 */
export interface UserSession {
  telegramUserId: number;
  unlockedAt: number; // Unix timestamp
  expiresAt: number; // Unix timestamp
  decryptedKeys: Map<Network, string>; // Temporarily cached decrypted keys
}

/**
 * Security action that may require password
 */
export type SecureAction =
  | 'export_key'
  | 'withdraw_large'
  | 'withdraw_new_address'
  | 'change_password'
  | 'add_whitelist'
  | 'remove_whitelist'
  | 'enable_2fa'
  | 'disable_2fa';

/**
 * Result of a security check
 */
export interface SecurityCheckResult {
  allowed: boolean;
  requiresPassword: boolean;
  requires2FA: boolean;
  reason?: string;
}

/**
 * Password setup state for new users
 */
export interface PasswordSetupState {
  stage: 'initial' | 'confirm' | 'complete';
  tempPassword?: string;
  attempts: number;
}
