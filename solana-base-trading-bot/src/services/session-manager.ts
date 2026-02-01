import { Network } from '../types';
import { createSessionEncryption } from '../utils/encryption';

/**
 * Session timeout in milliseconds (default: 30 minutes)
 */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Maximum sessions to prevent memory leak
 */
const MAX_SESSIONS = 10000;

interface Session {
  telegramUserId: number;
  unlockedAt: number;
  expiresAt: number;
  // Encrypted in-memory with session-specific key
  encryptedKeys: Map<Network, string>;
  sessionCrypto: ReturnType<typeof createSessionEncryption>;
}

/**
 * In-memory session store
 * Keys are encrypted even in memory to mitigate memory dumps
 */
const sessions = new Map<number, Session>();

/**
 * Cleanup interval reference
 */
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start session cleanup interval
 */
export function startSessionCleanup(): void {
  if (cleanupInterval) return;
  
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [userId, session] of sessions) {
      if (session.expiresAt < now) {
        sessions.delete(userId);
      }
    }
  }, 60000); // Check every minute
}

/**
 * Stop session cleanup
 */
export function stopSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Create or refresh a session for a user
 */
export function createSession(
  telegramUserId: number,
  timeoutMs: number = SESSION_TIMEOUT_MS
): Session {
  // Enforce max sessions
  if (sessions.size >= MAX_SESSIONS) {
    // Remove oldest expired sessions first
    const now = Date.now();
    for (const [userId, session] of sessions) {
      if (session.expiresAt < now) {
        sessions.delete(userId);
      }
    }
    // If still too many, remove oldest
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = [...sessions.entries()]
        .sort((a, b) => a[1].unlockedAt - b[1].unlockedAt)[0];
      if (oldest) sessions.delete(oldest[0]);
    }
  }

  const now = Date.now();
  const session: Session = {
    telegramUserId,
    unlockedAt: now,
    expiresAt: now + timeoutMs,
    encryptedKeys: new Map(),
    sessionCrypto: createSessionEncryption(),
  };

  sessions.set(telegramUserId, session);
  return session;
}

/**
 * Get active session for a user (null if expired or doesn't exist)
 */
export function getSession(telegramUserId: number): Session | null {
  const session = sessions.get(telegramUserId);
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    sessions.delete(telegramUserId);
    return null;
  }

  return session;
}

/**
 * Refresh session timeout
 */
export function refreshSession(
  telegramUserId: number,
  timeoutMs: number = SESSION_TIMEOUT_MS
): boolean {
  const session = getSession(telegramUserId);
  if (!session) return false;

  session.expiresAt = Date.now() + timeoutMs;
  return true;
}

/**
 * Store a decrypted key in the session (encrypted with session key)
 */
export function storeKeyInSession(
  telegramUserId: number,
  network: Network,
  privateKey: string
): boolean {
  const session = getSession(telegramUserId);
  if (!session) return false;

  // Encrypt the private key with session-specific key
  const encrypted = session.sessionCrypto.encrypt(privateKey);
  session.encryptedKeys.set(network, encrypted);
  return true;
}

/**
 * Get a decrypted key from session
 */
export function getKeyFromSession(
  telegramUserId: number,
  network: Network
): string | null {
  const session = getSession(telegramUserId);
  if (!session) return null;

  const encrypted = session.encryptedKeys.get(network);
  if (!encrypted) return null;

  return session.sessionCrypto.decrypt(encrypted);
}

/**
 * Check if session has a key for network
 */
export function hasKeyInSession(
  telegramUserId: number,
  network: Network
): boolean {
  const session = getSession(telegramUserId);
  if (!session) return false;
  return session.encryptedKeys.has(network);
}

/**
 * Lock a session (logout)
 */
export function lockSession(telegramUserId: number): void {
  sessions.delete(telegramUserId);
}

/**
 * Lock all sessions (emergency)
 */
export function lockAllSessions(): void {
  sessions.clear();
}

/**
 * Get session info (without sensitive data)
 */
export function getSessionInfo(telegramUserId: number): {
  active: boolean;
  expiresIn: number;
  networks: Network[];
} | null {
  const session = getSession(telegramUserId);
  if (!session) {
    return { active: false, expiresIn: 0, networks: [] };
  }

  return {
    active: true,
    expiresIn: Math.max(0, session.expiresAt - Date.now()),
    networks: [...session.encryptedKeys.keys()],
  };
}

/**
 * Get remaining session time in minutes
 */
export function getSessionTimeRemaining(telegramUserId: number): number {
  const session = getSession(telegramUserId);
  if (!session) return 0;
  return Math.max(0, Math.floor((session.expiresAt - Date.now()) / 60000));
}
