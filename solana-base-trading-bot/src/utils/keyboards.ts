import { Markup } from 'telegraf';
import { InlineKeyboardButton } from 'telegraf/types';
import { Network, TokenInfo, TokenHolding } from '../types';

// ── Token address shortener ──
// Telegram limits callback_data to 64 bytes.
// Token addresses are ~44 chars, so we map them to short IDs.
const tokenMap = new Map<string, string>();
const reverseMap = new Map<string, string>();
let tokenCounter = 0;

export function shortenToken(address: string): string {
  const key = address.toLowerCase();
  const existing = reverseMap.get(key);
  if (existing) return existing;

  const id = 't' + (++tokenCounter).toString(36);
  tokenMap.set(id, address);
  reverseMap.set(key, id);
  return id;
}

export function expandToken(id: string): string | undefined {
  return tokenMap.get(id);
}

// ── Helper to shorten network ──
function n(network: Network): string {
  return network === 'solana' ? 'sol' : 'bas';
}

// ── Callback code reference ──
// m          = main menu
// w          = wallet network select
// wb:N       = wallet balance
// we:N       = wallet export key
// wi:N       = wallet import
// wc:N       = wallet create
// wn:N       = wallet show (after network select)
// ws         = wallet switch network (same as w)
// h          = holdings network select
// h:N        = holdings for network
// hv:N:T     = holding view detail
// hp:N:P     = holdings page
// hr:N       = holdings refresh
// b          = buy network select
// bn:N       = buy on network (paste address prompt)
// bc:N:T     = buy confirm (show amount selection)
// ba:N:T:A   = buy amount (execute)
// bp:N:T:P   = buy percent (execute)
// bx:N:T     = buy custom amount
// s          = sell network select
// sn:N       = sell on network (show holdings)
// ss:N:T     = sell select (show holding detail)
// sp:N:T:P   = sell percent (execute)
// sx:N:T     = sell custom amount
// st         = settings network select
// st:N       = settings for network
// sl:N       = slippage menu
// sls:N:V    = slippage set value
// slc:N      = slippage custom
// db:N       = default buy amount
// pf:sol     = priority fee
// snet       = settings switch network
// dx:N:T     = dexscreener link
// tr:N:T     = token refresh
// cf:A:P     = confirm action
// hp2        = help

/**
 * Main menu keyboard
 */
export function getMainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💰 Wallet', 'w'),
      Markup.button.callback('📊 Holdings', 'h'),
    ],
    [
      Markup.button.callback('🛒 Buy Token', 'b'),
      Markup.button.callback('💸 Sell Token', 's'),
    ],
    [
      Markup.button.callback('⚙️ Settings', 'st'),
      Markup.button.callback('📜 History', 'hi'),
    ],
    [
      Markup.button.callback('ℹ️ Help', 'hp2'),
    ],
  ]);
}

/**
 * Network selection keyboard
 * action: w, h, b, s, st (wallet, holdings, buy, sell, settings)
 */
export function getNetworkSelectionKeyboard(action: string) {
  // Map long action names to short codes for commands.ts compatibility
  const shortAction: Record<string, string> = {
    wallet: 'wn',
    holdings: 'h',
    buy: 'bn',
    sell: 'sn',
    settings: 'st',
  };
  const prefix = shortAction[action] || action;

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('☀️ Solana', `${prefix}:sol`),
      Markup.button.callback('🔵 Base', `${prefix}:bas`),
    ],
    [
      Markup.button.callback('« Back', 'm'),
    ],
  ]);
}

/**
 * Wallet menu keyboard
 */
export function getWalletMenuKeyboard(network: Network) {
  const ns = n(network);
  const emoji = network === 'solana' ? '☀️' : '🔵';

  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`${emoji} View Balance`, `wb:${ns}`),
    ],
    [
      Markup.button.callback('💸 Withdraw', `wd:${ns}`),
    ],
    [
      Markup.button.callback('📤 Export Key', `we:${ns}`),
      Markup.button.callback('📥 Import', `wi:${ns}`),
    ],
    [
      Markup.button.callback('🔄 Switch Network', 'w'),
      Markup.button.callback('« Back', 'm'),
    ],
  ]);
}

/**
 * Token confirmation keyboard (after pasting contract address)
 */
export function getTokenConfirmKeyboard(network: Network, tokenAddress: string) {
  const ns = n(network);
  const t = shortenToken(tokenAddress);

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Yes, Buy This', `bc:${ns}:${t}`),
    ],
    [
      Markup.button.callback('❌ Cancel', 'm'),
    ],
  ]);
}

/**
 * Buy amount selection keyboard
 */
export function getBuyAmountKeyboard(network: Network, tokenAddress: string) {
  const ns = n(network);
  const t = shortenToken(tokenAddress);
  const sym = network === 'solana' ? 'SOL' : 'ETH';

  const amounts =
    network === 'solana'
      ? ['0.1', '0.5', '1', '2', '5']
      : ['0.01', '0.05', '0.1', '0.25', '0.5'];

  return Markup.inlineKeyboard([
    amounts.slice(0, 3).map((amt) =>
      Markup.button.callback(`${amt} ${sym}`, `ba:${ns}:${t}:${amt}`)
    ),
    amounts.slice(3).map((amt) =>
      Markup.button.callback(`${amt} ${sym}`, `ba:${ns}:${t}:${amt}`)
    ),
    [
      Markup.button.callback('25%', `bp:${ns}:${t}:25`),
      Markup.button.callback('50%', `bp:${ns}:${t}:50`),
      Markup.button.callback('100%', `bp:${ns}:${t}:100`),
    ],
    [
      Markup.button.callback('✏️ Custom', `bx:${ns}:${t}`),
    ],
    [
      Markup.button.callback('« Back', 'b'),
      Markup.button.callback('❌ Cancel', 'm'),
    ],
  ]);
}

/**
 * Sell amount selection keyboard
 */
export function getSellAmountKeyboard(
  network: Network,
  tokenAddress: string,
  _symbol: string
) {
  const ns = n(network);
  const t = shortenToken(tokenAddress);

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('25%', `sp:${ns}:${t}:25`),
      Markup.button.callback('50%', `sp:${ns}:${t}:50`),
    ],
    [
      Markup.button.callback('75%', `sp:${ns}:${t}:75`),
      Markup.button.callback('100%', `sp:${ns}:${t}:100`),
    ],
    [
      Markup.button.callback('✏️ Custom', `sx:${ns}:${t}`),
    ],
    [
      Markup.button.callback('« Back', 'h'),
      Markup.button.callback('❌ Cancel', 'm'),
    ],
  ]);
}

/**
 * Holdings list keyboard
 */
export function getHoldingsKeyboard(
  holdings: TokenHolding[],
  network: Network,
  page: number = 0
) {
  const ns = n(network);
  const pageSize = 5;
  const start = page * pageSize;
  const end = start + pageSize;
  const pageHoldings = holdings.slice(start, end);

  const buttons: InlineKeyboardButton[][] = pageHoldings.map((holding) => {
    const t = shortenToken(holding.tokenAddress);
    return [
      Markup.button.callback(
        `${holding.symbol} - $${holding.valueUsd}`,
        `hv:${ns}:${t}`
      ),
    ];
  });

  // Pagination
  const navButtons: InlineKeyboardButton[] = [];
  if (page > 0) {
    navButtons.push(
      Markup.button.callback('« Prev', `hp:${ns}:${page - 1}`)
    );
  }
  if (end < holdings.length) {
    navButtons.push(
      Markup.button.callback('Next »', `hp:${ns}:${page + 1}`)
    );
  }
  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }

  buttons.push([
    Markup.button.callback('🔄 Refresh', `hr:${ns}`),
    Markup.button.callback('« Back', 'm'),
  ]);

  return Markup.inlineKeyboard(buttons);
}

/**
 * Token holding detail keyboard
 */
export function getHoldingDetailKeyboard(holding: TokenHolding) {
  const ns = n(holding.network);
  const t = shortenToken(holding.tokenAddress);

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💸 Sell', `ss:${ns}:${t}`),
    ],
    [
      Markup.button.callback('📊 DexScreener', `dx:${ns}:${t}`),
    ],
    [
      Markup.button.callback('« Back', `h:${ns}`),
    ],
  ]);
}

/**
 * Settings keyboard
 */
export function getSettingsKeyboard(network: Network) {
  const ns = n(network);

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Slippage', `sl:${ns}`),
    ],
    [
      Markup.button.callback('💰 Default Buy', `db:${ns}`),
    ],
    [
      Markup.button.callback('⚡ Priority Fee', 'pf:sol'),
    ],
    [
      Markup.button.callback('🔄 Switch Network', 'snet'),
      Markup.button.callback('« Back', 'm'),
    ],
  ]);
}

/**
 * Slippage selection keyboard
 */
export function getSlippageKeyboard(network: Network) {
  const ns = n(network);

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('0.5%', `sls:${ns}:50`),
      Markup.button.callback('1%', `sls:${ns}:100`),
      Markup.button.callback('2%', `sls:${ns}:200`),
    ],
    [
      Markup.button.callback('3%', `sls:${ns}:300`),
      Markup.button.callback('5%', `sls:${ns}:500`),
      Markup.button.callback('10%', `sls:${ns}:1000`),
    ],
    [
      Markup.button.callback('✏️ Custom', `slc:${ns}`),
    ],
    [
      Markup.button.callback('« Back', `st:${ns}`),
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
      Markup.button.callback('✅ Confirm', `cf:${action}:${paramStr}`),
      Markup.button.callback('❌ Cancel', 'm'),
    ],
  ]);
}

/**
 * Transaction result keyboard
 */
export function getTransactionResultKeyboard(
  explorerUrl?: string,
  _network?: Network
) {
  const buttons: InlineKeyboardButton[][] = [];

  if (explorerUrl) {
    buttons.push([Markup.button.url('🔍 View Transaction', explorerUrl)]);
  }

  buttons.push([
    Markup.button.callback('📊 Holdings', 'h'),
    Markup.button.callback('🏠 Main Menu', 'm'),
  ]);

  return Markup.inlineKeyboard(buttons);
}

/**
 * Quick trade keyboard (shown after viewing token info)
 */
export function getQuickTradeKeyboard(network: Network, tokenAddress: string) {
  const ns = n(network);
  const t = shortenToken(tokenAddress);

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🛒 Buy', `bc:${ns}:${t}`),
      Markup.button.callback('💸 Sell', `ss:${ns}:${t}`),
    ],
    [
      Markup.button.callback('🔄 Refresh', `tr:${ns}:${t}`),
    ],
    [
      Markup.button.callback('« Back', 'm'),
    ],
  ]);
}
