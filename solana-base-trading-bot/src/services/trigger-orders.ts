import { Telegraf } from 'telegraf';
import { Network } from '../types';
import { TriggerOrder, CreateTriggerOrderParams } from '../types/trigger-orders';
import { getTokenInfo } from './dexscreener';
import { 
  buySolanaToken, 
  sellSolanaTokenPercentage,
  getSolanaKeypair 
} from './solana';
import { 
  buyBaseToken, 
  sellBaseTokenPercentage,
  getBaseAccount 
} from './base';
import * as triggerDb from './trigger-orders-db';
import { config } from '../config';

// Monitoring configuration
const POLL_INTERVAL_MS = 12000; // 12 seconds - balance between responsiveness and rate limits
const JITTER_MS = 3000; // Add some randomness to avoid patterns

let bot: Telegraf | null = null;
let isMonitoring = false;
let monitoringTimeout: NodeJS.Timeout | null = null;

/**
 * Initialize the trigger order service with the Telegram bot instance
 */
export function initTriggerOrderService(telegrafBot: Telegraf): void {
  bot = telegrafBot;
  console.log('[TriggerOrders] Service initialized');
}

/**
 * Start the price monitoring loop
 */
export function startMonitoring(): void {
  if (isMonitoring) {
    console.log('[TriggerOrders] Monitoring already running');
    return;
  }
  
  isMonitoring = true;
  console.log('[TriggerOrders] Starting price monitoring...');
  scheduleNextCheck();
}

/**
 * Stop the monitoring loop
 */
export function stopMonitoring(): void {
  isMonitoring = false;
  if (monitoringTimeout) {
    clearTimeout(monitoringTimeout);
    monitoringTimeout = null;
  }
  console.log('[TriggerOrders] Monitoring stopped');
}

/**
 * Schedule the next price check with jitter
 */
function scheduleNextCheck(): void {
  if (!isMonitoring) return;
  
  const delay = POLL_INTERVAL_MS + Math.random() * JITTER_MS;
  monitoringTimeout = setTimeout(async () => {
    await checkPricesAndExecute();
    scheduleNextCheck();
  }, delay);
}

/**
 * Main monitoring loop - check prices and execute triggered orders
 */
async function checkPricesAndExecute(): Promise<void> {
  try {
    // Get all tokens that have active orders
    const tokensToCheck = triggerDb.getTokensWithActiveOrders();
    
    if (tokensToCheck.length === 0) {
      return; // Nothing to monitor
    }
    
    // Group by network to batch requests
    const solanaTokens = tokensToCheck.filter(t => t.network === 'solana');
    const baseTokens = tokensToCheck.filter(t => t.network === 'base');
    
    // Fetch prices for all tokens
    const priceMap = new Map<string, { price: number; marketCap: number }>();
    
    // Process tokens with a small delay between each to avoid rate limits
    for (const { network, tokenAddress } of tokensToCheck) {
      try {
        const tokenInfo = await getTokenInfo(tokenAddress, network);
        if (tokenInfo) {
          const key = `${network}:${tokenAddress.toLowerCase()}`;
          priceMap.set(key, {
            price: parseFloat(tokenInfo.priceUsd) || 0,
            marketCap: tokenInfo.marketCap || 0
          });
        }
        // Small delay between requests to be nice to the API
        await sleep(200);
      } catch (err) {
        console.error(`[TriggerOrders] Error fetching price for ${tokenAddress}:`, err);
      }
    }
    
    // Check each active order against current prices
    const activeOrders = triggerDb.getActiveTriggerOrders();
    
    for (const order of activeOrders) {
      const key = `${order.network}:${order.tokenAddress.toLowerCase()}`;
      const priceData = priceMap.get(key);
      
      if (!priceData) continue;
      
      const currentValue = order.triggerType === 'price' 
        ? priceData.price 
        : priceData.marketCap;
      
      if (currentValue === 0) continue;
      
      // Check if trigger condition is met
      const triggered = checkTriggerCondition(
        currentValue,
        order.triggerValue,
        order.triggerCondition
      );
      
      if (triggered) {
        console.log(`[TriggerOrders] Order #${order.id} triggered! Current: ${currentValue}, Target: ${order.triggerValue}`);
        await executeOrder(order, priceData.price);
      }
    }
    
  } catch (error) {
    console.error('[TriggerOrders] Error in monitoring loop:', error);
  }
}

/**
 * Check if a trigger condition is met
 */
function checkTriggerCondition(
  currentValue: number,
  targetValue: number,
  condition: 'above' | 'below'
): boolean {
  if (condition === 'above') {
    return currentValue >= targetValue;
  } else {
    return currentValue <= targetValue;
  }
}

/**
 * Execute a triggered order
 */
async function executeOrder(order: TriggerOrder, currentPrice: number): Promise<void> {
  // Mark as triggered
  triggerDb.markOrderTriggered(order.id);
  
  try {
    let result;
    
    if (order.side === 'buy') {
      // Execute buy order
      if (order.network === 'solana') {
        // Check if wallet is unlocked
        const keypair = getSolanaKeypair(order.telegramUserId);
        if (!keypair) {
          throw new Error('Wallet locked - please unlock with /unlock');
        }
        
        const solAmount = parseFloat(order.amount);
        result = await buySolanaToken(
          order.telegramUserId,
          order.tokenAddress,
          solAmount,
          order.slippageBps
        );
      } else {
        // Base network
        const account = getBaseAccount(order.telegramUserId);
        if (!account) {
          throw new Error('Wallet locked - please unlock with /unlock');
        }
        
        const ethAmount = parseFloat(order.amount);
        result = await buyBaseToken(
          order.telegramUserId,
          order.tokenAddress,
          ethAmount,
          order.slippageBps
        );
      }
    } else {
      // Execute sell order
      const percentage = parseInt(order.amount);
      
      if (order.network === 'solana') {
        const keypair = getSolanaKeypair(order.telegramUserId);
        if (!keypair) {
          throw new Error('Wallet locked - please unlock with /unlock');
        }
        
        result = await sellSolanaTokenPercentage(
          order.telegramUserId,
          order.tokenAddress,
          percentage,
          order.slippageBps
        );
      } else {
        const account = getBaseAccount(order.telegramUserId);
        if (!account) {
          throw new Error('Wallet locked - please unlock with /unlock');
        }
        
        result = await sellBaseTokenPercentage(
          order.telegramUserId,
          order.tokenAddress,
          percentage,
          order.slippageBps
        );
      }
    }
    
    if (result.success) {
      const txHash = result.signature || result.hash || '';
      triggerDb.markOrderExecuted(order.id, txHash, currentPrice);
      await notifyOrderExecuted(order, txHash, currentPrice, result.explorerUrl);
    } else {
      throw new Error(result.error || 'Transaction failed');
    }
    
  } catch (error: any) {
    const errorMsg = error.message || 'Unknown error';
    console.error(`[TriggerOrders] Failed to execute order #${order.id}:`, errorMsg);
    triggerDb.markOrderFailed(order.id, errorMsg);
    await notifyOrderFailed(order, errorMsg);
  }
}

/**
 * Send notification when order is executed successfully
 */
async function notifyOrderExecuted(
  order: TriggerOrder,
  txHash: string,
  executionPrice: number,
  explorerUrl?: string
): Promise<void> {
  if (!bot) return;
  
  const sideEmoji = order.side === 'buy' ? '🟢' : '🔴';
  const networkName = order.network === 'solana' ? 'Solana' : 'Base';
  const triggerTypeLabel = order.triggerType === 'price' ? 'Price' : 'Market Cap';
  
  let amountLabel: string;
  if (order.side === 'buy') {
    const currency = order.network === 'solana' ? 'SOL' : 'ETH';
    amountLabel = `${order.amount} ${currency}`;
  } else {
    amountLabel = `${order.amount}%`;
  }
  
  const message = [
    `${sideEmoji} *LIMIT ORDER EXECUTED*`,
    ``,
    `📊 *${order.tokenSymbol}* (${networkName})`,
    ``,
    `• Type: ${order.side.toUpperCase()}`,
    `• Trigger: ${triggerTypeLabel} ${order.triggerCondition} $${formatNumber(order.triggerValue)}`,
    `• Amount: ${amountLabel}`,
    `• Execution Price: $${formatPrice(executionPrice)}`,
    ``,
    explorerUrl ? `🔗 [View Transaction](${explorerUrl})` : `\`${txHash}\``,
  ].join('\n');
  
  try {
    await bot.telegram.sendMessage(order.chatId, message, { 
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true }
    });
  } catch (err) {
    console.error('[TriggerOrders] Failed to send execution notification:', err);
  }
}

/**
 * Send notification when order fails
 */
async function notifyOrderFailed(order: TriggerOrder, error: string): Promise<void> {
  if (!bot) return;
  
  const networkName = order.network === 'solana' ? 'Solana' : 'Base';
  
  const message = [
    `⚠️ *LIMIT ORDER FAILED*`,
    ``,
    `📊 *${order.tokenSymbol}* (${networkName})`,
    `• Order ID: #${order.id}`,
    `• Type: ${order.side.toUpperCase()}`,
    ``,
    `❌ Error: ${escapeMarkdown(error)}`,
    ``,
    `_The order has been marked as failed. Create a new order if needed._`
  ].join('\n');
  
  try {
    await bot.telegram.sendMessage(order.chatId, message, { 
      parse_mode: 'Markdown' 
    });
  } catch (err) {
    console.error('[TriggerOrders] Failed to send failure notification:', err);
  }
}

// ============ Public API ============

/**
 * Create a new trigger order
 */
export function createOrder(params: CreateTriggerOrderParams): TriggerOrder {
  const order = triggerDb.createTriggerOrder(params);
  console.log(`[TriggerOrders] Created order #${order.id}: ${order.side} ${order.tokenSymbol} when ${order.triggerType} ${order.triggerCondition} ${order.triggerValue}`);
  
  // Make sure monitoring is running
  if (!isMonitoring) {
    startMonitoring();
  }
  
  return order;
}

/**
 * Cancel an order
 */
export function cancelOrder(orderId: number, userId: number): boolean {
  return triggerDb.cancelOrder(orderId, userId);
}

/**
 * Cancel all orders for a user
 */
export function cancelAllOrders(userId: number): number {
  return triggerDb.cancelAllUserOrders(userId);
}

/**
 * Get user's active orders
 */
export function getActiveOrders(userId: number): TriggerOrder[] {
  return triggerDb.getUserActiveOrders(userId);
}

/**
 * Get user's order history
 */
export function getOrderHistory(userId: number, limit?: number): TriggerOrder[] {
  return triggerDb.getUserOrderHistory(userId, limit);
}

/**
 * Get a specific order
 */
export function getOrder(orderId: number): TriggerOrder | null {
  return triggerDb.getTriggerOrder(orderId);
}

// ============ Helpers ============

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toFixed(2);
}

function formatPrice(price: number): string {
  if (price === 0) return '0';
  if (price < 0.00000001) return price.toExponential(2);
  if (price < 0.0001) return price.toFixed(8);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(2);
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
