import Database from 'better-sqlite3';
import { Network } from '../types';
import { 
  TriggerOrder, 
  CreateTriggerOrderParams, 
  OrderStatus,
  TriggerType,
  TriggerCondition,
  OrderSide 
} from '../types/trigger-orders';

let db: Database.Database;

/**
 * Initialize trigger orders table
 */
export function initTriggerOrdersTable(database: Database.Database): void {
  db = database;
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS trigger_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      network TEXT NOT NULL,
      token_address TEXT NOT NULL,
      token_symbol TEXT NOT NULL,
      
      side TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_condition TEXT NOT NULL,
      trigger_value REAL NOT NULL,
      
      amount TEXT NOT NULL,
      amount_type TEXT NOT NULL,
      slippage_bps INTEGER DEFAULT 100,
      
      status TEXT DEFAULT 'active',
      price_at_creation REAL NOT NULL,
      
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      triggered_at TEXT,
      executed_at TEXT,
      
      tx_hash TEXT,
      execution_price REAL,
      error TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_trigger_orders_user 
      ON trigger_orders(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_trigger_orders_status 
      ON trigger_orders(status);
    CREATE INDEX IF NOT EXISTS idx_trigger_orders_active 
      ON trigger_orders(status, network, token_address);
  `);
}

/**
 * Create a new trigger order
 */
export function createTriggerOrder(params: CreateTriggerOrderParams): TriggerOrder {
  const stmt = db.prepare(`
    INSERT INTO trigger_orders (
      telegram_user_id, chat_id, network, token_address, token_symbol,
      side, trigger_type, trigger_condition, trigger_value,
      amount, amount_type, slippage_bps, status, price_at_creation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `);
  
  const result = stmt.run(
    params.telegramUserId,
    params.chatId,
    params.network,
    params.tokenAddress,
    params.tokenSymbol,
    params.side,
    params.triggerType,
    params.triggerCondition,
    params.triggerValue,
    params.amount,
    params.amountType,
    params.slippageBps || 100,
    params.currentPrice
  );
  
  return getTriggerOrder(result.lastInsertRowid as number)!;
}

/**
 * Get a trigger order by ID
 */
export function getTriggerOrder(id: number): TriggerOrder | null {
  const row = db.prepare(`SELECT * FROM trigger_orders WHERE id = ?`).get(id) as any;
  if (!row) return null;
  return mapRowToOrder(row);
}

/**
 * Get all active trigger orders
 */
export function getActiveTriggerOrders(): TriggerOrder[] {
  const rows = db.prepare(`
    SELECT * FROM trigger_orders 
    WHERE status = 'active'
    ORDER BY created_at ASC
  `).all() as any[];
  
  return rows.map(mapRowToOrder);
}

/**
 * Get active orders for a specific token
 */
export function getActiveOrdersForToken(network: Network, tokenAddress: string): TriggerOrder[] {
  const rows = db.prepare(`
    SELECT * FROM trigger_orders 
    WHERE status = 'active' 
      AND network = ? 
      AND LOWER(token_address) = LOWER(?)
    ORDER BY created_at ASC
  `).all(network, tokenAddress) as any[];
  
  return rows.map(mapRowToOrder);
}

/**
 * Get active orders for a user
 */
export function getUserActiveOrders(telegramUserId: number): TriggerOrder[] {
  const rows = db.prepare(`
    SELECT * FROM trigger_orders 
    WHERE telegram_user_id = ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(telegramUserId) as any[];
  
  return rows.map(mapRowToOrder);
}

/**
 * Get order history for a user
 */
export function getUserOrderHistory(telegramUserId: number, limit: number = 20): TriggerOrder[] {
  const rows = db.prepare(`
    SELECT * FROM trigger_orders 
    WHERE telegram_user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(telegramUserId, limit) as any[];
  
  return rows.map(mapRowToOrder);
}

/**
 * Mark order as triggered (condition met, about to execute)
 */
export function markOrderTriggered(id: number): void {
  db.prepare(`
    UPDATE trigger_orders 
    SET status = 'triggered', triggered_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);
}

/**
 * Mark order as successfully executed
 */
export function markOrderExecuted(
  id: number, 
  txHash: string, 
  executionPrice: number
): void {
  db.prepare(`
    UPDATE trigger_orders 
    SET status = 'executed', 
        executed_at = CURRENT_TIMESTAMP,
        tx_hash = ?,
        execution_price = ?
    WHERE id = ?
  `).run(txHash, executionPrice, id);
}

/**
 * Mark order as failed
 */
export function markOrderFailed(id: number, error: string): void {
  db.prepare(`
    UPDATE trigger_orders 
    SET status = 'failed', error = ?
    WHERE id = ?
  `).run(error, id);
}

/**
 * Cancel an order
 */
export function cancelOrder(id: number, telegramUserId: number): boolean {
  const result = db.prepare(`
    UPDATE trigger_orders 
    SET status = 'cancelled'
    WHERE id = ? AND telegram_user_id = ? AND status = 'active'
  `).run(id, telegramUserId);
  
  return result.changes > 0;
}

/**
 * Cancel all active orders for a user
 */
export function cancelAllUserOrders(telegramUserId: number): number {
  const result = db.prepare(`
    UPDATE trigger_orders 
    SET status = 'cancelled'
    WHERE telegram_user_id = ? AND status = 'active'
  `).run(telegramUserId);
  
  return result.changes;
}

/**
 * Get unique tokens with active orders (for price monitoring)
 */
export function getTokensWithActiveOrders(): { network: Network; tokenAddress: string }[] {
  const rows = db.prepare(`
    SELECT DISTINCT network, token_address 
    FROM trigger_orders 
    WHERE status = 'active'
  `).all() as any[];
  
  return rows.map(row => ({
    network: row.network as Network,
    tokenAddress: row.token_address
  }));
}

/**
 * Map database row to TriggerOrder object
 */
function mapRowToOrder(row: any): TriggerOrder {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    chatId: row.chat_id,
    network: row.network as Network,
    tokenAddress: row.token_address,
    tokenSymbol: row.token_symbol,
    side: row.side as OrderSide,
    triggerType: row.trigger_type as TriggerType,
    triggerCondition: row.trigger_condition as TriggerCondition,
    triggerValue: row.trigger_value,
    amount: row.amount,
    amountType: row.amount_type as 'fixed' | 'percentage',
    slippageBps: row.slippage_bps,
    status: row.status as OrderStatus,
    priceAtCreation: row.price_at_creation,
    createdAt: row.created_at,
    triggeredAt: row.triggered_at,
    executedAt: row.executed_at,
    txHash: row.tx_hash,
    executionPrice: row.execution_price,
    error: row.error
  };
}
