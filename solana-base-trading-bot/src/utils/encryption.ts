import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Encrypt a string using AES-256-CBC
 */
export function encrypt(text: string): string {
  const key = Buffer.from(config.walletEncryptionKey, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Prepend IV to encrypted data
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt a string encrypted with encrypt()
 */
export function decrypt(encryptedText: string): string {
  const key = Buffer.from(config.walletEncryptionKey, 'hex');
  const parts = encryptedText.split(':');
  
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted text format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Generate a random encryption key (for .env setup)
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
