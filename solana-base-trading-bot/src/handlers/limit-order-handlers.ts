import { Context, Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { Network, TokenInfo } from '../types';
import { PendingTriggerOrder, TriggerOrder } from '../types/trigger-orders';
import * as triggerOrders from '../services/trigger-orders';
import * as dexscreener from '../services/dexscreener';
import * as keyboards from '../utils/keyboards';
import { getUserState, setUserState, clearUserState } from './commands';

// ============ Command Handlers ============

/**
 * /limit command - show limit order menu
 */
export async function handleLimit(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  const activeOrders = triggerOrders.getActiveOrders(userId);
  
  let message = '📊 *Limit Orders*\n\n';
  message += 'Set automatic buy/sell orders that execute when your price or market cap target is hit.\n\n';
  
  if (activeOrders.length > 0) {
    message += `📋 You have *${activeOrders.length}* active order(s)\n`;
  }
  
  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('🟢 New Limit Buy', 'limit_new_buy'),
        Markup.button.callback('🔴 New Limit Sell', 'limit_new_sell'),
      ],
      [Markup.button.callback('📋 View Active Orders', 'limit_view_active')],
      [Markup.button.callback('📜 Order History', 'limit_history')],
      [Markup.button.callback('🏠 Main Menu', 'menu')],
    ]),
  });
}

/**
 * /orders command - show active orders
 */
export async function handleOrders(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  await showActiveOrders(ctx, userId);
}

// ============ Callback Handlers ============

/**
 * Handle all limit order related callbacks
 */
export async function handleLimitCallback(ctx: Context, action: string): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;
  
  // Parse action
  if (action === 'limit_new_buy') {
    await startNewOrder(ctx, userId, 'buy');
    return true;
  }
  
  if (action === 'limit_new_sell') {
    await startNewOrder(ctx, userId, 'sell');
    return true;
  }
  
  if (action === 'limit_view_active') {
    await showActiveOrders(ctx, userId);
    return true;
  }
  
  if (action === 'limit_history') {
    await showOrderHistory(ctx, userId);
    return true;
  }
  
  if (action.startsWith('limit_net_')) {
    const network = action.replace('limit_net_', '') as Network;
    await handleNetworkSelected(ctx, userId, network);
    return true;
  }
  
  if (action.startsWith('limit_trigger_')) {
    const triggerType = action.replace('limit_trigger_', '') as 'price' | 'marketcap';
    await handleTriggerTypeSelected(ctx, userId, triggerType);
    return true;
  }
  
  if (action.startsWith('limit_cond_')) {
    const condition = action.replace('limit_cond_', '') as 'above' | 'below';
    await handleConditionSelected(ctx, userId, condition);
    return true;
  }
  
  if (action === 'limit_confirm') {
    await confirmAndCreateOrder(ctx, userId);
    return true;
  }
  
  if (action === 'limit_cancel') {
    clearUserState(userId);
    await ctx.editMessageText('❌ Order creation cancelled.', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('📊 Limit Orders', 'limit_menu')],
        [Markup.button.callback('🏠 Main Menu', 'menu')],
      ]).reply_markup,
    });
    return true;
  }
  
  if (action === 'limit_menu') {
    await handleLimit(ctx);
    return true;
  }
  
  if (action.startsWith('limit_cancel_')) {
    const orderId = parseInt(action.replace('limit_cancel_', ''));
    await cancelOrder(ctx, userId, orderId);
    return true;
  }
  
  if (action === 'limit_cancel_all') {
    await cancelAllOrders(ctx, userId);
    return true;
  }
  
  return false;
}

/**
 * Handle text input for limit orders
 */
export async function handleLimitTextInput(ctx: Context, text: string): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;
  
  const state = getUserState(userId);
  const pending = (state as any).pendingTriggerOrder as PendingTriggerOrder | undefined;
  
  if (!pending) return false;
  
  if (pending.stage === 'select_trigger' && !pending.tokenAddress) {
    // User is entering a token address
    await handleTokenAddressInput(ctx, userId, text, pending);
    return true;
  }
  
  if (pending.stage === 'enter_price') {
    await handlePriceInput(ctx, userId, text, pending);
    return true;
  }
  
  if (pending.stage === 'enter_amount') {
    await handleAmountInput(ctx, userId, text, pending);
    return true;
  }
  
  return false;
}

// ============ Flow Handlers ============

async function startNewOrder(ctx: Context, userId: number, side: 'buy' | 'sell'): Promise<void> {
  setUserState(userId, {
    pendingTriggerOrder: {
      stage: 'select_type',
      side,
    },
  } as any);
  
  const sideEmoji = side === 'buy' ? '🟢' : '🔴';
  const sideLabel = side === 'buy' ? 'Buy' : 'Sell';
  
  await ctx.editMessageText(
    `${sideEmoji} *New Limit ${sideLabel}*\n\n` +
    `Select the network:`,
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback('☀️ Solana', 'limit_net_solana'),
          Markup.button.callback('🔵 Base', 'limit_net_base'),
        ],
        [Markup.button.callback('❌ Cancel', 'limit_cancel')],
      ]).reply_markup,
    }
  );
}

async function handleNetworkSelected(ctx: Context, userId: number, network: Network): Promise<void> {
  const state = getUserState(userId);
  const pending = (state as any).pendingTriggerOrder as PendingTriggerOrder;
  
  if (!pending) return;
  
  setUserState(userId, {
    pendingTriggerOrder: {
      ...pending,
      network,
      stage: 'select_trigger',
    },
  } as any);
  
  const networkName = network === 'solana' ? 'Solana' : 'Base';
  
  await ctx.editMessageText(
    `📍 Network: *${networkName}*\n\n` +
    `Paste the token contract address:`,
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'limit_cancel')],
      ]).reply_markup,
    }
  );
}

async function handleTokenAddressInput(
  ctx: Context, 
  userId: number, 
  address: string,
  pending: PendingTriggerOrder
): Promise<void> {
  // Validate address format
  const network = pending.network!;
  const isValidSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  const isValidEvm = /^0x[a-fA-F0-9]{40}$/.test(address);
  
  if (network === 'solana' && !isValidSolana) {
    await ctx.reply('❌ Invalid Solana address. Please enter a valid token address:');
    return;
  }
  if (network === 'base' && !isValidEvm) {
    await ctx.reply('❌ Invalid Base address. Please enter a valid 0x token address:');
    return;
  }
  
  // Fetch token info
  await ctx.reply('🔍 Fetching token info...');
  
  const tokenInfo = await dexscreener.getTokenInfo(address, network);
  
  if (!tokenInfo) {
    await ctx.reply(
      '❌ Token not found or has no liquidity.\n\nPlease verify the address and try again:',
      Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'limit_cancel')],
      ])
    );
    return;
  }
  
  // Update state with token info
  setUserState(userId, {
    pendingTriggerOrder: {
      ...pending,
      tokenAddress: address,
      tokenSymbol: tokenInfo.symbol,
      currentPrice: parseFloat(tokenInfo.priceUsd),
      currentMcap: tokenInfo.marketCap,
      stage: 'select_trigger',
    },
  } as any);
  
  const sideEmoji = pending.side === 'buy' ? '🟢' : '🔴';
  
  await ctx.reply(
    `${sideEmoji} *Limit ${pending.side!.toUpperCase()}* - ${tokenInfo.symbol}\n\n` +
    `📍 Token: *${tokenInfo.name}*\n` +
    `💵 Current Price: $${formatPrice(parseFloat(tokenInfo.priceUsd))}\n` +
    `🏛 Market Cap: $${formatNumber(tokenInfo.marketCap || 0)}\n\n` +
    `What should trigger this order?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('💵 Price Target', 'limit_trigger_price'),
          Markup.button.callback('🏛 Market Cap', 'limit_trigger_marketcap'),
        ],
        [Markup.button.callback('❌ Cancel', 'limit_cancel')],
      ]),
    }
  );
}

async function handleTriggerTypeSelected(
  ctx: Context, 
  userId: number, 
  triggerType: 'price' | 'marketcap'
): Promise<void> {
  const state = getUserState(userId);
  const pending = (state as any).pendingTriggerOrder as PendingTriggerOrder;
  
  if (!pending) return;
  
  setUserState(userId, {
    pendingTriggerOrder: {
      ...pending,
      triggerType,
    },
  } as any);
  
  const triggerLabel = triggerType === 'price' ? 'Price' : 'Market Cap';
  const currentValue = triggerType === 'price' 
    ? `$${formatPrice(pending.currentPrice || 0)}`
    : `$${formatNumber(pending.currentMcap || 0)}`;
  
  // For buys: typically want to buy when price drops (below)
  // For sells: typically want to sell when price rises (above)
  const defaultCondition = pending.side === 'buy' ? 'below' : 'above';
  const otherCondition = pending.side === 'buy' ? 'above' : 'below';
  
  const belowLabel = pending.side === 'buy' 
    ? '📉 Below (Buy the Dip)' 
    : '📉 Below (Stop Loss)';
  const aboveLabel = pending.side === 'buy' 
    ? '📈 Above (Breakout Buy)' 
    : '📈 Above (Take Profit)';
  
  await ctx.editMessageText(
    `📊 *${pending.tokenSymbol}* - Limit ${pending.side!.toUpperCase()}\n\n` +
    `Trigger: *${triggerLabel}*\n` +
    `Current: ${currentValue}\n\n` +
    `When should the order execute?`,
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(belowLabel, 'limit_cond_below')],
        [Markup.button.callback(aboveLabel, 'limit_cond_above')],
        [Markup.button.callback('❌ Cancel', 'limit_cancel')],
      ]).reply_markup,
    }
  );
}

async function handleConditionSelected(
  ctx: Context,
  userId: number,
  condition: 'above' | 'below'
): Promise<void> {
  const state = getUserState(userId);
  const pending = (state as any).pendingTriggerOrder as PendingTriggerOrder;
  
  if (!pending) return;
  
  setUserState(userId, {
    pendingTriggerOrder: {
      ...pending,
      triggerCondition: condition,
      stage: 'enter_price',
    },
  } as any);
  
  const triggerLabel = pending.triggerType === 'price' ? 'price' : 'market cap';
  const currentValue = pending.triggerType === 'price'
    ? formatPrice(pending.currentPrice || 0)
    : formatNumber(pending.currentMcap || 0);
  
  await ctx.editMessageText(
    `📊 *${pending.tokenSymbol}* - Limit ${pending.side!.toUpperCase()}\n\n` +
    `Trigger: ${pending.triggerType === 'price' ? '💵' : '🏛'} ${pending.triggerType} ${condition}\n` +
    `Current: $${currentValue}\n\n` +
    `Enter your target ${triggerLabel} in USD:`,
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'limit_cancel')],
      ]).reply_markup,
    }
  );
}

async function handlePriceInput(
  ctx: Context,
  userId: number,
  text: string,
  pending: PendingTriggerOrder
): Promise<void> {
  // Parse the target value
  let targetValue = parseTargetValue(text);
  
  if (!targetValue || targetValue <= 0) {
    await ctx.reply(
      '❌ Invalid value. Please enter a positive number.\n\n' +
      'Examples: `0.00001`, `1.5`, `100K`, `5M`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  setUserState(userId, {
    pendingTriggerOrder: {
      ...pending,
      triggerValue: targetValue,
      stage: 'enter_amount',
    },
  } as any);
  
  const currency = pending.network === 'solana' ? 'SOL' : 'ETH';
  
  if (pending.side === 'buy') {
    await ctx.reply(
      `📊 *${pending.tokenSymbol}* - Limit BUY\n\n` +
      `Trigger: $${formatNumber(targetValue)}\n\n` +
      `Enter the amount of *${currency}* to spend:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('0.1 ' + currency, 'limit_amt_0.1'),
            Markup.button.callback('0.5 ' + currency, 'limit_amt_0.5'),
            Markup.button.callback('1 ' + currency, 'limit_amt_1'),
          ],
          [Markup.button.callback('❌ Cancel', 'limit_cancel')],
        ]),
      }
    );
  } else {
    await ctx.reply(
      `📊 *${pending.tokenSymbol}* - Limit SELL\n\n` +
      `Trigger: $${formatNumber(targetValue)}\n\n` +
      `Enter the percentage of your holdings to sell:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('25%', 'limit_pct_25'),
            Markup.button.callback('50%', 'limit_pct_50'),
            Markup.button.callback('75%', 'limit_pct_75'),
            Markup.button.callback('100%', 'limit_pct_100'),
          ],
          [Markup.button.callback('❌ Cancel', 'limit_cancel')],
        ]),
      }
    );
  }
}

async function handleAmountInput(
  ctx: Context,
  userId: number,
  text: string,
  pending: PendingTriggerOrder
): Promise<void> {
  let amount: string;
  let amountType: 'fixed' | 'percentage';
  
  if (pending.side === 'buy') {
    const parsed = parseFloat(text.replace(/[^\d.]/g, ''));
    if (isNaN(parsed) || parsed <= 0) {
      await ctx.reply('❌ Invalid amount. Please enter a positive number:');
      return;
    }
    amount = parsed.toString();
    amountType = 'fixed';
  } else {
    const parsed = parseInt(text.replace(/[^\d]/g, ''));
    if (isNaN(parsed) || parsed <= 0 || parsed > 100) {
      await ctx.reply('❌ Invalid percentage. Please enter a number between 1 and 100:');
      return;
    }
    amount = parsed.toString();
    amountType = 'percentage';
  }
  
  setUserState(userId, {
    pendingTriggerOrder: {
      ...pending,
      amount,
      amountType,
      stage: 'confirm',
    },
  } as any);
  
  await showConfirmation(ctx, userId, { ...pending, amount, amountType });
}

async function showConfirmation(
  ctx: Context,
  userId: number,
  pending: PendingTriggerOrder
): Promise<void> {
  const sideEmoji = pending.side === 'buy' ? '🟢' : '🔴';
  const networkName = pending.network === 'solana' ? 'Solana' : 'Base';
  const currency = pending.network === 'solana' ? 'SOL' : 'ETH';
  const triggerLabel = pending.triggerType === 'price' ? 'Price' : 'Market Cap';
  
  let amountLabel: string;
  if (pending.side === 'buy') {
    amountLabel = `${pending.amount} ${currency}`;
  } else {
    amountLabel = `${pending.amount}% of holdings`;
  }
  
  const conditionLabel = pending.triggerCondition === 'above' ? '≥' : '≤';
  
  const message = [
    `${sideEmoji} *Confirm Limit ${pending.side!.toUpperCase()}*`,
    ``,
    `📊 Token: *${pending.tokenSymbol}*`,
    `📍 Network: ${networkName}`,
    ``,
    `*Trigger Condition:*`,
    `${triggerLabel} ${conditionLabel} $${formatNumber(pending.triggerValue!)}`,
    ``,
    `*Amount:* ${amountLabel}`,
    ``,
    `_Current ${triggerLabel.toLowerCase()}: $${formatNumber(pending.triggerType === 'price' ? pending.currentPrice! : pending.currentMcap!)}*_`,
  ].join('\n');
  
  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ Create Order', 'limit_confirm')],
      [Markup.button.callback('❌ Cancel', 'limit_cancel')],
    ]),
  });
}

async function confirmAndCreateOrder(ctx: Context, userId: number): Promise<void> {
  const state = getUserState(userId);
  const pending = (state as any).pendingTriggerOrder as PendingTriggerOrder;
  
  if (!pending || !pending.tokenAddress || !pending.triggerValue) {
    await ctx.reply('❌ Session expired. Please start again.');
    clearUserState(userId);
    return;
  }
  
  try {
    const order = triggerOrders.createOrder({
      telegramUserId: userId,
      chatId: ctx.chat!.id,
      network: pending.network!,
      tokenAddress: pending.tokenAddress,
      tokenSymbol: pending.tokenSymbol!,
      side: pending.side!,
      triggerType: pending.triggerType!,
      triggerCondition: pending.triggerCondition!,
      triggerValue: pending.triggerValue,
      amount: pending.amount!,
      amountType: pending.amountType!,
      currentPrice: pending.currentPrice!,
    });
    
    const sideEmoji = order.side === 'buy' ? '🟢' : '🔴';
    
    await ctx.editMessageText(
      `✅ *Limit Order Created!*\n\n` +
      `${sideEmoji} *${order.tokenSymbol}* - ${order.side.toUpperCase()}\n` +
      `Order ID: #${order.id}\n\n` +
      `I'll execute this automatically when the target is hit and notify you here.`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('📋 View Orders', 'limit_view_active')],
          [Markup.button.callback('🏠 Main Menu', 'menu')],
        ]).reply_markup,
      }
    );
    
    clearUserState(userId);
    
  } catch (error: any) {
    await ctx.reply(`❌ Failed to create order: ${error.message}`);
  }
}

// ============ View Orders ============

async function showActiveOrders(ctx: Context, userId: number): Promise<void> {
  const orders = triggerOrders.getActiveOrders(userId);
  
  if (orders.length === 0) {
    const message = '📋 *Active Limit Orders*\n\nNo active orders.';
    
    if ('editMessageText' in ctx && ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('➕ Create Order', 'limit_menu')],
          [Markup.button.callback('🏠 Main Menu', 'menu')],
        ]).reply_markup,
      });
    } else {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Create Order', 'limit_menu')],
          [Markup.button.callback('🏠 Main Menu', 'menu')],
        ]),
      });
    }
    return;
  }
  
  let message = `📋 *Active Limit Orders* (${orders.length})\n\n`;
  
  const buttons: any[][] = [];
  
  for (const order of orders) {
    const sideEmoji = order.side === 'buy' ? '🟢' : '🔴';
    const networkEmoji = order.network === 'solana' ? '☀️' : '🔵';
    const triggerLabel = order.triggerType === 'price' ? 'Price' : 'MCap';
    const condLabel = order.triggerCondition === 'above' ? '≥' : '≤';
    
    message += `${sideEmoji} #${order.id} ${networkEmoji} *${order.tokenSymbol}*\n`;
    message += `   ${order.side.toUpperCase()} when ${triggerLabel} ${condLabel} $${formatNumber(order.triggerValue)}\n`;
    message += `   Amount: ${order.side === 'buy' ? order.amount + (order.network === 'solana' ? ' SOL' : ' ETH') : order.amount + '%'}\n\n`;
    
    buttons.push([Markup.button.callback(`❌ Cancel #${order.id}`, `limit_cancel_${order.id}`)]);
  }
  
  if (orders.length > 1) {
    buttons.push([Markup.button.callback('🗑 Cancel All', 'limit_cancel_all')]);
  }
  buttons.push([Markup.button.callback('📊 Limit Orders', 'limit_menu')]);
  buttons.push([Markup.button.callback('🏠 Main Menu', 'menu')]);
  
  if ('editMessageText' in ctx && ctx.callbackQuery) {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  } else {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  }
}

async function showOrderHistory(ctx: Context, userId: number): Promise<void> {
  const orders = triggerOrders.getOrderHistory(userId, 10);
  
  if (orders.length === 0) {
    await ctx.editMessageText('📜 *Order History*\n\nNo orders yet.', {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('📊 Limit Orders', 'limit_menu')],
        [Markup.button.callback('🏠 Main Menu', 'menu')],
      ]).reply_markup,
    });
    return;
  }
  
  let message = '📜 *Order History* (last 10)\n\n';
  
  for (const order of orders) {
    const sideEmoji = order.side === 'buy' ? '🟢' : '🔴';
    const statusEmoji = getStatusEmoji(order.status);
    const networkEmoji = order.network === 'solana' ? '☀️' : '🔵';
    
    message += `${statusEmoji} ${sideEmoji} ${networkEmoji} *${order.tokenSymbol}*\n`;
    message += `   ${order.status.toUpperCase()}`;
    if (order.executionPrice) {
      message += ` @ $${formatPrice(order.executionPrice)}`;
    }
    message += '\n\n';
  }
  
  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('📋 Active Orders', 'limit_view_active')],
      [Markup.button.callback('📊 Limit Orders', 'limit_menu')],
      [Markup.button.callback('🏠 Main Menu', 'menu')],
    ]).reply_markup,
  });
}

async function cancelOrder(ctx: Context, userId: number, orderId: number): Promise<void> {
  const success = triggerOrders.cancelOrder(orderId, userId);
  
  if (success) {
    await ctx.answerCbQuery('✅ Order cancelled');
    await showActiveOrders(ctx, userId);
  } else {
    await ctx.answerCbQuery('❌ Failed to cancel order');
  }
}

async function cancelAllOrders(ctx: Context, userId: number): Promise<void> {
  const count = triggerOrders.cancelAllOrders(userId);
  await ctx.answerCbQuery(`✅ Cancelled ${count} orders`);
  await showActiveOrders(ctx, userId);
}

// ============ Helpers ============

function parseTargetValue(text: string): number | null {
  // Remove $ and whitespace
  text = text.replace(/[$\s,]/g, '').toUpperCase();
  
  let multiplier = 1;
  
  if (text.endsWith('K')) {
    multiplier = 1_000;
    text = text.slice(0, -1);
  } else if (text.endsWith('M')) {
    multiplier = 1_000_000;
    text = text.slice(0, -1);
  } else if (text.endsWith('B')) {
    multiplier = 1_000_000_000;
    text = text.slice(0, -1);
  }
  
  const value = parseFloat(text);
  if (isNaN(value)) return null;
  
  return value * multiplier;
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

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'active': return '⏳';
    case 'triggered': return '⚡';
    case 'executed': return '✅';
    case 'failed': return '❌';
    case 'cancelled': return '🚫';
    default: return '❓';
  }
}
