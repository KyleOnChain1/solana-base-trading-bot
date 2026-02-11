import { initSecurityTables } from './security-database';
import { initTriggerOrdersTable } from './trigger-orders-db';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { UserWallet, TradeSettings, Network } from '../types';

let db: Database.Database;

/**
 * Initialize database with required tables
 */
export function initDatabase(): void {
  // Ensure data directory exists
  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  
  db = new Database(config.databasePath);
  
  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');
  
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER NOT NULL,
      network TEXT NOT NULL,
      address TEXT NOT NULL,
      encrypted_private_key TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(telegram_user_id, network)
    );
    
    CREATE TABLE IF NOT EXISTS trade_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER NOT NULL,
      network TEXT NOT NULL,
      default_buy_amount_sol TEXT,
      default_buy_amount_eth TEXT,
      default_buy_percentage INTEGER,
      slippage_bps INTEGER DEFAULT 100,
      priority_fee_lamports INTEGER DEFAULT 100000,
      UNIQUE(telegram_user_id, network)
    );
    
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER NOT NULL,
      network TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      action TEXT NOT NULL,
      token_address TEXT NOT NULL,
      token_symbol TEXT,
      amount_in TEXT,
      amount_out TEXT,
      price_usd TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_settings_user ON trade_settings(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(telegram_user_id);
  `);
  
  // Initialize security tables
  initSecurityTables(db);
  
  // Initialize trigger orders tables
  initTriggerOrdersTable(db);
}

// ============ Wallet Operations ============

/**
 * Get wallet for a user and network
 */
export function getWallet(telegramUserId: number, network: Network): UserWallet | null {
  const row = db.prepare(`
    SELECT id, telegram_user_id, network, address, encrypted_private_key, created_at
    FROM wallets
    WHERE telegram_user_id = ? AND network = ?
  `).get(telegramUserId, network) as any;
  
  if (!row) return null;
  
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    network: row.network as Network,
    address: row.address,
    encryptedPrivateKey: row.encrypted_private_key,
    createdAt: row.created_at,
  };
}

/**
 * Get all wallets for a user
 */
export function getAllWallets(telegramUserId: number): UserWallet[] {
  const rows = db.prepare(`
    SELECT id, telegram_user_id, network, address, encrypted_private_key, created_at
    FROM wallets
    WHERE telegram_user_id = ?
  `).all(telegramUserId) as any[];
  
  return rows.map(row => ({
    id: row.id,
    telegramUserId: row.telegram_user_id,
    network: row.network as Network,
    address: row.address,
    encryptedPrivateKey: row.encrypted_private_key,
    createdAt: row.created_at,
  }));
}

/**
 * Save or update wallet
 */
export function saveWallet(
  telegramUserId: number,
  network: Network,
  address: string,
  encryptedPrivateKey: string
): void {
  db.prepare(`
    INSERT INTO wallets (telegram_user_id, network, address, encrypted_private_key)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(telegram_user_id, network) DO UPDATE SET
      address = excluded.address,
      encrypted_private_key = excluded.encrypted_private_key
  `).run(telegramUserId, network, address, encryptedPrivateKey);
}

/**
 * Delete wallet
 */
export function deleteWallet(telegramUserId: number, network: Network): boolean {
  const result = db.prepare(`
    DELETE FROM wallets WHERE telegram_user_id = ? AND network = ?
  `).run(telegramUserId, network);
  
  return result.changes > 0;
}

// ============ Settings Operations ============

/**
 * Get trade settings for a user and network
 */
export function getTradeSettings(telegramUserId: number, network: Network): TradeSettings {
  const row = db.prepare(`
    SELECT * FROM trade_settings
    WHERE telegram_user_id = ? AND network = ?
  `).get(telegramUserId, network) as any;
  
  if (!row) {
    // Return defaults
    return {
      userId: telegramUserId,
      network,
      slippageBps: config.defaultSlippageBps,
      priorityFeeLamports: config.defaultPriorityFeeLamports,
    };
  }
  
  return {
    userId: row.telegram_user_id,
    network: row.network as Network,
    defaultBuyAmountSol: row.default_buy_amount_sol,
    defaultBuyAmountEth: row.default_buy_amount_eth,
    defaultBuyPercentage: row.default_buy_percentage,
    slippageBps: row.slippage_bps,
    priorityFeeLamports: row.priority_fee_lamports,
  };
}

/**
 * Save trade settings
 */
export function saveTradeSettings(settings: TradeSettings): void {
  db.prepare(`
    INSERT INTO trade_settings (
      telegram_user_id, network, default_buy_amount_sol, default_buy_amount_eth,
      default_buy_percentage, slippage_bps, priority_fee_lamports
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_user_id, network) DO UPDATE SET
      default_buy_amount_sol = excluded.default_buy_amount_sol,
      default_buy_amount_eth = excluded.default_buy_amount_eth,
      default_buy_percentage = excluded.default_buy_percentage,
      slippage_bps = excluded.slippage_bps,
      priority_fee_lamports = excluded.priority_fee_lamports
  `).run(
    settings.userId,
    settings.network,
    settings.defaultBuyAmountSol || null,
    settings.defaultBuyAmountEth || null,
    settings.defaultBuyPercentage || null,
    settings.slippageBps,
    settings.priorityFeeLamports || null
  );
}

// ============ Transaction History ============

/**
 * Record a transaction
 */
export function recordTransaction(
  telegramUserId: number,
  network: Network,
  txHash: string,
  action: 'buy' | 'sell',
  tokenAddress: string,
  tokenSymbol: string,
  amountIn: string,
  amountOut: string,
  priceUsd?: string
): void {
  db.prepare(`
    INSERT INTO transactions (
      telegram_user_id, network, tx_hash, action, token_address,
      token_symbol, amount_in, amount_out, price_usd
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    telegramUserId, network, txHash, action, tokenAddress,
    tokenSymbol, amountIn, amountOut, priceUsd || null
  );
}

/**
 * Get recent transactions for a user
 */
export function getRecentTransactions(telegramUserId: number, limit: number = 10): any[] {
  return db.prepare(`
    SELECT * FROM transactions
    WHERE telegram_user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(telegramUserId, limit) as any[];
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}

/**
 * Get unique tracked token addresses for a user on a specific network
 */
export function getTrackedTokens(telegramUserId: number, network: string): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT token_address FROM transactions
    WHERE telegram_user_id = ? AND network = ?
  `).all(telegramUserId, network) as any[];
  return rows.map(r => r.token_address);
}
