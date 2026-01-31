import { Markup } from 'telegraf';
import { InlineKeyboardButton } from 'telegraf/types';
import { Network, TokenInfo, TokenHolding } from '../types';

/**
 * Main menu keyboard
 */
export function getMainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💰 Wallet', 'menu:wallet'),
      Markup.button.callback('📊 Holdings', 'menu:holdings'),
    ],
    [
      Markup.button.callback('🛒 Buy Token', 'menu:buy'),
      Markup.button.callback('💸 Sell Token', 'menu:sell'),
    ],
    [
      Markup.button.callback('⚙️ Settings', 'menu:settings'),
      Markup.button.callback('📜 History', 'menu:history'),
    ],
    [
      Markup.button.callback('ℹ️ Help', 'menu:help'),
    ],
  ]);
}

/**
 * Network selection keyboard
 */
export function getNetworkSelectionKeyboard(action: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('☀️ Solana', `${action}:network:solana`),
      Markup.button.callback('🔵 Base', `${action}:network:base`),
    ],
    [
      Markup.button.callback('« Back', 'menu:main'),
    ],
  ]);
}

/**
 * Wallet menu keyboard
 */
export function getWalletMenuKeyboard(network: Network) {
  const emoji = network === 'solana' ? '☀️' : '🔵';
  
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`${emoji} View Balance`, `wallet:balance:${network}`),
    ],
    [
      Markup.button.callback('📤 Export Private Key', `wallet:export:${network}`),
      Markup.button.callback('📥 Import Wallet', `wallet:import:${network}`),
    ],
    [
      Markup.button.callback('🔄 Switch Network', 'menu:wallet'),
      Markup.button.callback('« Back', 'menu:main'),
    ],
  ]);
}

/**
 * Token confirmation keyboard (after pasting contract address)
 */
export function getTokenConfirmKeyboard(network: Network, tokenAddress: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Yes, Buy This', `buy:confirm:${network}:${tokenAddress}`),
    ],
    [
      Markup.button.callback('❌ Cancel', 'menu:main'),
    ],
  ]);
}

/**
 * Buy amount selection keyboard
 */
export function getBuyAmountKeyboard(network: Network, tokenAddress: string) {
  const nativeSymbol = network === 'solana' ? 'SOL' : 'ETH';
  
  const amounts = network === 'solana' 
    ? ['0.1', '0.5', '1', '2', '5']
    : ['0.01', '0.05', '0.1', '0.25', '0.5'];
  
  return Markup.inlineKeyboard([
    amounts.slice(0, 3).map(amt => 
      Markup.button.callback(`${amt} ${nativeSymbol}`, `buy:amount:${network}:${tokenAddress}:${amt}`)
    ),
    amounts.slice(3).map(amt => 
      Markup.button.callback(`${amt} ${nativeSymbol}`, `buy:amount:${network}:${tokenAddress}:${amt}`)
    ),
    [
      Markup.button.callback('25%', `buy:percent:${network}:${tokenAddress}:25`),
      Markup.button.callback('50%', `buy:percent:${network}:${tokenAddress}:50`),
      Markup.button.callback('100%', `buy:percent:${network}:${tokenAddress}:100`),
    ],
    [
      Markup.button.callback('✏️ Custom Amount', `buy:custom:${network}:${tokenAddress}`),
    ],
    [
      Markup.button.callback('« Back', 'menu:buy'),
      Markup.button.callback('❌ Cancel', 'menu:main'),
    ],
  ]);
}

/**
 * Sell amount selection keyboard
 */
export function getSellAmountKeyboard(network: Network, tokenAddress: string, symbol: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('25%', `sell:percent:${network}:${tokenAddress}:25`),
      Markup.button.callback('50%', `sell:percent:${network}:${tokenAddress}:50`),
    ],
    [
      Markup.button.callback('75%', `sell:percent:${network}:${tokenAddress}:75`),
      Markup.button.callback('100%', `sell:percent:${network}:${tokenAddress}:100`),
    ],
    [
      Markup.button.callback('✏️ Custom Amount', `sell:custom:${network}:${tokenAddress}`),
    ],
    [
      Markup.button.callback('« Back', 'menu:holdings'),
      Markup.button.callback('❌ Cancel', 'menu:main'),
    ],
  ]);
}

/**
 * Holdings list keyboard
 */
export function getHoldingsKeyboard(holdings: TokenHolding[], network: Network, page: number = 0) {
  const pageSize = 5;
  const start = page * pageSize;
  const end = start + pageSize;
  const pageHoldings = holdings.slice(start, end);
  
  const buttons: InlineKeyboardButton[][] = pageHoldings.map(holding => [
    Markup.button.callback(
      `${holding.symbol} - $${holding.valueUsd}`,
      `holding:view:${network}:${holding.tokenAddress}`
    ),
  ]);
  
  // Pagination
  const navButtons: InlineKeyboardButton[] = [];
  if (page > 0) {
    navButtons.push(Markup.button.callback('« Prev', `holdings:page:${network}:${page - 1}`));
  }
  if (end < holdings.length) {
    navButtons.push(Markup.button.callback('Next »', `holdings:page:${network}:${page + 1}`));
  }
  
  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }
  
  buttons.push([
    Markup.button.callback('🔄 Refresh', `holdings:refresh:${network}`),
    Markup.button.callback('« Back', 'menu:main'),
  ]);
  
  return Markup.inlineKeyboard(buttons);
}

/**
 * Token holding detail keyboard
 */
export function getHoldingDetailKeyboard(holding: TokenHolding) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💸 Sell', `sell:select:${holding.network}:${holding.tokenAddress}`),
    ],
    [
      Markup.button.callback('📊 View on DexScreener', `external:dexscreener:${holding.network}:${holding.tokenAddress}`),
    ],
    [
      Markup.button.callback('« Back to Holdings', `menu:holdings:${holding.network}`),
    ],
  ]);
}

/**
 * Settings keyboard
 */
export function getSettingsKeyboard(network: Network) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Slippage', `settings:slippage:${network}`),
    ],
    [
      Markup.button.callback('💰 Default Buy Amount', `settings:buyamount:${network}`),
    ],
    [
      Markup.button.callback('⚡ Priority Fee (Solana)', `settings:priority:solana`),
    ],
    [
      Markup.button.callback('🔄 Switch Network', 'settings:network'),
      Markup.button.callback('« Back', 'menu:main'),
    ],
  ]);
}

/**
 * Slippage selection keyboard
 */
export function getSlippageKeyboard(network: Network) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('0.5%', `settings:slippage:set:${network}:50`),
      Markup.button.callback('1%', `settings:slippage:set:${network}:100`),
      Markup.button.callback('2%', `settings:slippage:set:${network}:200`),
    ],
    [
      Markup.button.callback('3%', `settings:slippage:set:${network}:300`),
      Markup.button.callback('5%', `settings:slippage:set:${network}:500`),
      Markup.button.callback('10%', `settings:slippage:set:${network}:1000`),
    ],
    [
      Markup.button.callback('✏️ Custom', `settings:slippage:custom:${network}`),
    ],
    [
      Markup.button.callback('« Back', `menu:settings:${network}`),
    ],
  ]);
}

/**
 * Confirmation keyboard for dangerous actions
 */
export function getConfirmationKeyboard(action: string, ...params: string[]) {
  const paramStr = params.join(':');
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Confirm', `confirm:${action}:${paramStr}`),
      Markup.button.callback('❌ Cancel', 'menu:main'),
    ],
  ]);
}

/**
 * Transaction result keyboard
 */
export function getTransactionResultKeyboard(explorerUrl?: string, network?: Network) {
  const buttons: InlineKeyboardButton[][] = [];
  
  if (explorerUrl) {
    buttons.push([
      Markup.button.url('🔍 View Transaction', explorerUrl),
    ]);
  }
  
  buttons.push([
    Markup.button.callback('📊 View Holdings', 'menu:holdings'),
    Markup.button.callback('🏠 Main Menu', 'menu:main'),
  ]);
  
  return Markup.inlineKeyboard(buttons);
}

/**
 * Quick trade keyboard (shown after viewing token info)
 */
export function getQuickTradeKeyboard(network: Network, tokenAddress: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🛒 Buy', `buy:confirm:${network}:${tokenAddress}`),
      Markup.button.callback('💸 Sell', `sell:select:${network}:${tokenAddress}`),
    ],
    [
      Markup.button.callback('🔄 Refresh Price', `token:refresh:${network}:${tokenAddress}`),
    ],
    [
      Markup.button.callback('« Back', 'menu:main'),
    ],
  ]);
}
