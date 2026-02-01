import { Context, Markup } from 'telegraf';
import { handleSecurityCallback, handleSecurity } from './security-handlers';
import { Network } from '../types';
import { config } from '../config';
import * as db from '../services/database';
import * as solana from '../services/solana';
import * as base from '../services/base';
import * as dexscreener from '../services/dexscreener';
import * as keyboards from '../utils/keyboards';
import * as formatters from '../utils/formatters';
import {
  getUserState,
  setUserState,
  clearUserState,
  executeBuy,
  executeSell,
} from './commands';

// ── Helper: expand short network code to Network type ──
function toNetwork(code: string): Network {
  return code === 'sol' ? 'solana' : 'base';
}

/**
 * Main callback query handler
 */
export async function handleCallback(ctx: Context): Promise<void> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery || !('data' in callbackQuery)) return;

  const data = callbackQuery.data;
  const userId = ctx.from?.id;
  if (!userId) return;

  const parts = data.split(':');
  const action = parts[0];

  try {
    switch (action) {
      // ── Navigation ──
      case 'm':
        await showMainMenu(ctx);
        break;
      case 'hp2':
        await showHelp(ctx);
        break;
      // ── Security ──
      case 'sec':
        if (parts[1] === 'main') {
          await handleSecurity(ctx);
        } else {
          await handleSecurityCallback(ctx, parts[1]);
        }
        break;
      case 'hi':
        await showHistory(ctx);
        break;

      // ── Wallet ──
      case 'w':
        await showWalletNetworkSelect(ctx);
        break;
      case 'wn':
        await showWalletInfo(ctx, toNetwork(parts[1]));
        break;
      case 'wb':
        await showWalletBalance(ctx, toNetwork(parts[1]));
        break;
      case 'we':
        await exportPrivateKey(ctx, toNetwork(parts[1]));
        break;
      case 'wi':
        await startWalletImport(ctx, toNetwork(parts[1]));
        break;
      case 'wc':
        await createWallet(ctx, toNetwork(parts[1]));
        break;
    // --- Withdraw ---
    case 'wd':
      await showWithdrawMenu(ctx, toNetwork(parts[1]));
      break;
    case 'wdt':
      await startWithdrawAddress(ctx, toNetwork(parts[1]), parts[2] || undefined);
      break;
    case 'wdc':
      await executeWithdrawAction(ctx);
      break;
    case 'wdx':
      clearUserState(ctx.from!.id);
      await ctx.answerCbQuery('Withdraw cancelled');
      await ctx.editMessageText('u274c Withdraw cancelled.', { parse_mode: 'Markdown', ...keyboards.getMainMenuKeyboard() });
      break;
      case 'ws':
        await showWalletNetworkSelect(ctx);
        break;
    // — Withdraw —
    case 'ww':
      await showWithdrawOptions(ctx, toNetwork(parts[1]));
      break;
    case 'wwn': // withdraw native (SOL/ETH)
      await startWithdrawNative(ctx, toNetwork(parts[1]));
      break;
    case 'wwt': // withdraw token - show token list
      await showWithdrawTokenList(ctx, toNetwork(parts[1]));
      break;
    case 'wwts': // withdraw specific token selected
      await startWithdrawToken(ctx, toNetwork(parts[1]), keyboards.expandToken(parts[2])!);
      break;
    case 'wwc': // confirm withdraw
      await executeWithdraw(ctx);
      break;
    case 'wwa': // withdraw all shortcut
      {
        const userId = ctx.from!.id;
        const st = getUserState(userId);
        if (st.pendingWithdraw && st.pendingWithdraw.stage === 'enter_amount') {
          const pw = st.pendingWithdraw;
          const gasNote = pw.tokenAddress === 'native' ? '\n⚠️ Gas reserve will be kept automatically.' : '';
          setUserState(userId, {
            currentAction: 'withdrawing',
            pendingWithdraw: { ...pw, amount: 'all', stage: 'confirm' },
          });
          await ctx.editMessageText(
            `���� *Confirm Withdrawal*\n\n` +
            `Token: *${pw.tokenSymbol}*\n` +
            `Amount: *all*\n` +
            `To: \`${pw.toAddress}\`\n` +
            `Network: *${pw.network === 'solana' ? 'Solana' : 'Base'}*` +
            gasNote,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('��✅ Confirm', 'wwc')],
                [Markup.button.callback('❌ Cancel', 'wwx')],
              ])
            }
          );
        }
      }
      break;
    case 'wwx': // cancel withdraw
      clearUserState(ctx.from!.id);
      await ctx.answerCbQuery('Withdrawal cancelled');
      await ctx.editMessageText('❌ Withdrawal cancelled.', { reply_markup: keyboards.getMainMenuKeyboard().reply_markup });
      break;

      // ── Holdings ──
      case 'h':
        if (parts[1]) {
          await showHoldings(ctx, toNetwork(parts[1]));
        } else {
          await showHoldingsNetworkSelect(ctx);
        }
        break;
      case 'hv':
        await showHoldingDetail(ctx, toNetwork(parts[1]), keyboards.expandToken(parts[2])!);
        break;
      case 'hp':
        await showHoldings(ctx, toNetwork(parts[1]), parseInt(parts[2]));
        break;
      case 'hr':
        await showHoldings(ctx, toNetwork(parts[1]));
        break;

      // ── Buy ──
      case 'b':
        await showBuyNetworkSelect(ctx);
        break;
      case 'bn':
        await startBuyOnNetwork(ctx, toNetwork(parts[1]));
        break;
      case 'bc':
        await showBuyAmountSelection(ctx, toNetwork(parts[1]), keyboards.expandToken(parts[2])!);
        break;
      case 'ba':
        await handleBuyAmount(ctx, toNetwork(parts[1]), keyboards.expandToken(parts[2])!, parseFloat(parts[3]));
        break;
      case 'bp':
        await handleBuyPercent(ctx, toNetwork(parts[1]), keyboards.expandToken(parts[2])!, parseInt(parts[3]));
        break;
      case 'bx':
        await startBuyCustomAmount(ctx, toNetwork(parts[1]), keyboards.expandToken(parts[2])!);
        break;

      // ── Sell ──
      case 's':
        await showSellNetworkSelect(ctx);
        break;
      case 'sn':
        await showHoldings(ctx, toNetwork(parts[1]));
        break;
      case 'ss':
        await showHoldingDetail(ctx, toNetwork(parts[1]), keyboards.expandToken(parts[2])!);
        break;
      case 'sp':
        await handleSellPercent(ctx, toNetwork(parts[1]), keyboards.expandToken(parts[2])!, parseInt(parts[3]));
        break;
      case 'sx':
        // Sell custom - for now treat as 100%
        await handleSellPercent(ctx, toNetwork(parts[1]), keyboards.expandToken(parts[2])!, 100);
        break;

      // ── Settings ──
      case 'st':
        if (parts[1]) {
          await showSettings(ctx, toNetwork(parts[1]));
        } else {
          await showSettingsNetworkSelect(ctx);
        }
        break;
      case 'snet':
        await showSettingsNetworkSelect(ctx);
        break;
      case 'sl':
        await showSlippageMenu(ctx, toNetwork(parts[1]));
        break;
      case 'sls':
        await setSlippage(ctx, toNetwork(parts[1]), parseInt(parts[2]));
        break;
      case 'slc':
        // Custom slippage - prompt user
        await ctx.editMessageText(
          '✏️ *Custom Slippage*\n\nPlease type your desired slippage in basis points (e.g., 150 for 1.5%):',
          { parse_mode: 'Markdown' }
        );
        break;
      case 'db':
        // Default buy amount settings - placeholder
        await ctx.answerCbQuery('Coming soon!');
        break;
      case 'pf':
        // Priority fee settings - placeholder
        await ctx.answerCbQuery('Coming soon!');
        break;

      // ── Token / misc ──
      case 'tr':
        await refreshToken(ctx, toNetwork(parts[1]), keyboards.expandToken(parts[2])!);
        break;
      case 'dx':
        await ctx.answerCbQuery('Open DexScreener in your browser');
        break;
      case 'cf':
        await handleConfirm(ctx, parts.slice(1));
        break;

      // ── Legacy long codes (wallet:create etc. used in inline keyboards) ──
      case 'wallet':
        await handleLegacyWallet(ctx, parts);
        break;
      case 'menu':
        await handleLegacyMenu(ctx, parts);
        break;

      default:
        await ctx.answerCbQuery('Unknown action');
    }
  } catch (error) {
    console.error('Callback error:', error);
    await ctx.answerCbQuery('An error occurred');
  }
}

// ════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════

async function showMainMenu(ctx: Context): Promise<void> {
  await ctx.editMessageText(
    '🚀 *Main Menu*\n\nWhat would you like to do?',
    { parse_mode: 'Markdown', ...keyboards.getMainMenuKeyboard() }
  );
  await ctx.answerCbQuery();
}

async function showHelp(ctx: Context): Promise<void> {
  await ctx.editMessageText(
    '📚 *Help*\n\n' +
      'Simply paste a token contract address to get started!\n\n' +
      '*Commands:*\n' +
      '/wallet - Manage wallets\n' +
      '/holdings - View holdings\n' +
      '/buy - Buy tokens\n' +
      '/sell - Sell tokens\n' +
      '/settings - Configure settings',
    { parse_mode: 'Markdown', ...keyboards.getMainMenuKeyboard() }
  );
  await ctx.answerCbQuery();
}

async function showHistory(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const transactions = db.getRecentTransactions(userId, 10);

  if (transactions.length === 0) {
    await ctx.editMessageText(
      '📜 *Transaction History*\n\nNo transactions yet.',
      { parse_mode: 'Markdown', ...keyboards.getMainMenuKeyboard() }
    );
  } else {
    let message = '📜 *Recent Transactions*\n\n';
    for (const tx of transactions) {
      const emoji = tx.action === 'buy' ? '🛒' : '💸';
      const net = tx.network === 'solana' ? '☀️' : '🔵';
      const date = new Date(tx.created_at).toLocaleDateString();
      message += `${emoji} ${net} ${tx.action.toUpperCase()} ${tx.token_symbol || 'Token'}\n`;
      message += `   ${formatters.truncateAddress(tx.tx_hash)} | ${date}\n\n`;
    }
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...keyboards.getMainMenuKeyboard(),
    });
  }
  await ctx.answerCbQuery();
}

// ════════════════════════════════════════════════════════
//  WALLET
// ════════════════════════════════════════════════════════

async function showWalletNetworkSelect(ctx: Context): Promise<void> {
  await ctx.editMessageText(
    '💰 *Wallet Management*\n\nSelect a network:',
    { parse_mode: 'Markdown', ...keyboards.getNetworkSelectionKeyboard('wallet') }
  );
  await ctx.answerCbQuery();
}

async function showWalletInfo(ctx: Context, network: Network): Promise<void> {
  const userId = ctx.from!.id;
  const wallet = db.getWallet(userId, network);
  const ns = network === 'solana' ? 'sol' : 'bas';

  if (!wallet) {
    await ctx.editMessageText(
      `💰 *${network === 'solana' ? 'Solana' : 'Base'} Wallet*\n\nNo wallet found. Would you like to create one?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔑 Create New Wallet', callback_data: `wc:${ns}` }],
            [{ text: '📥 Import Existing', callback_data: `wi:${ns}` }],
            [{ text: '« Back', callback_data: 'w' }],
          ],
        },
      }
    );
  } else {
    await ctx.editMessageText(
      `💰 *${network === 'solana' ? 'Solana ☀️' : 'Base 🔵'} Wallet*\n\n` +
        `*Address:*\n\`${wallet.address}\`\n\n` +
        `Created: ${new Date(wallet.createdAt).toLocaleDateString()}`,
      { parse_mode: 'Markdown', ...keyboards.getWalletMenuKeyboard(network) }
    );
  }
  await ctx.answerCbQuery();
}

async function showWalletBalance(ctx: Context, network: Network): Promise<void> {
  const userId = ctx.from!.id;
  const wallet = db.getWallet(userId, network);

  if (!wallet) {
    await ctx.answerCbQuery('No wallet found');
    return;
  }

  await ctx.answerCbQuery('Fetching balance...');

  let message: string;
  if (network === 'solana') {
    const balance = await solana.getSolBalance(wallet.address);
    message =
      `💰 *Solana Wallet Balance*\n\n` +
      `*Address:*\n\`${wallet.address}\`\n\n` +
      `*SOL Balance:* ${balance.sol.toFixed(4)} SOL\n` +
      `*USD Value:* $${balance.usd.toFixed(2)}`;
  } else {
    const balance = await base.getEthBalance(wallet.address);
    message =
      `💰 *Base Wallet Balance*\n\n` +
      `*Address:*\n\`${wallet.address}\`\n\n` +
      `*ETH Balance:* ${parseFloat(balance.eth).toFixed(4)} ETH\n` +
      `*USD Value:* $${balance.usd.toFixed(2)}`;
  }

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboards.getWalletMenuKeyboard(network),
  });
}

async function createWallet(ctx: Context, network: Network): Promise<void> {
  const userId = ctx.from!.id;
  await ctx.answerCbQuery('Creating wallet...');

  let result;
  if (network === 'solana') {
    result = await solana.createSolanaWallet(userId);
  } else {
    result = await base.createBaseWallet(userId);
  }

  if (result.created) {
    await ctx.editMessageText(
      `✅ *Wallet Created!*\n\n` +
        `*Network:* ${network === 'solana' ? 'Solana ☀️' : 'Base 🔵'}\n` +
        `*Address:*\n\`${result.address}\`\n\n` +
        `⚠️ *Important:* Export and backup your private key!`,
      { parse_mode: 'Markdown', ...keyboards.getWalletMenuKeyboard(network) }
    );
  } else {
    await ctx.editMessageText(
      `ℹ️ *Wallet Already Exists*\n\n*Address:*\n\`${result.address}\``,
      { parse_mode: 'Markdown', ...keyboards.getWalletMenuKeyboard(network) }
    );
  }
}

async function exportPrivateKey(ctx: Context, network: Network): Promise<void> {
  const userId = ctx.from!.id;

  let privateKey: string | null;
  if (network === 'solana') {
    privateKey = solana.exportSolanaPrivateKey(userId);
  } else {
    privateKey = base.exportBasePrivateKey(userId);
  }

  if (!privateKey) {
    await ctx.answerCbQuery('No wallet found');
    return;
  }

  const msg = await ctx.reply(
    `🔐 *Private Key*\n\n` +
      `⚠️ *NEVER share this with anyone!*\n\n` +
      `\`${privateKey}\`\n\n` +
      `_This message will be deleted in 30 seconds._`,
    { parse_mode: 'Markdown' }
  );

  setTimeout(async () => {
    try {
      await ctx.deleteMessage(msg.message_id);
    } catch (e) {
      // Ignore
    }
  }, 30000);

  await ctx.answerCbQuery('Private key sent! Delete after saving.');
}

async function startWalletImport(ctx: Context, network: Network): Promise<void> {
  const userId = ctx.from!.id;
  setUserState(userId, { selectedNetwork: network, currentAction: 'settings' });
  await ctx.editMessageText(
    `⚠️ *Import ${network === 'solana' ? 'Solana' : 'Base'} Wallet*\n\n` +
      `Please send your private key in the next message.\n\n` +
      `🔒 Your private key will be encrypted and stored securely.\n` +
      `⚠️ The message will be deleted for security.`,
    { parse_mode: 'Markdown' }
  );
  await ctx.answerCbQuery();
}

// ════════════════════════════════════════════════════════
//  HOLDINGS
// ════════════════════════════════════════════════════════

async function showHoldingsNetworkSelect(ctx: Context): Promise<void> {
  await ctx.editMessageText(
    '📊 *Token Holdings*\n\nSelect a network:',
    { parse_mode: 'Markdown', ...keyboards.getNetworkSelectionKeyboard('holdings') }
  );
  await ctx.answerCbQuery();
}

async function showHoldings(
  ctx: Context,
  network: Network,
  page: number = 0
): Promise<void> {
  const userId = ctx.from!.id;
  const wallet = db.getWallet(userId, network);
  const ns = network === 'solana' ? 'sol' : 'bas';

  if (!wallet) {
    await ctx.editMessageText(
      `📊 *${network === 'solana' ? 'Solana' : 'Base'} Holdings*\n\nNo wallet found. Create one first!`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💰 Create Wallet', callback_data: `wc:${ns}` }],
            [{ text: '« Back', callback_data: 'm' }],
          ],
        },
      }
    );
    await ctx.answerCbQuery();
    return;
  }

  let holdings: any;
  let nativeBalance: any;

  if (network === 'solana') {
    holdings = await solana.getSolanaTokenHoldings(wallet.address);
    nativeBalance = await solana.getSolBalance(wallet.address);
  } else {
    const trackedTokens = db.getTrackedTokens(userId, 'base');
    holdings = await base.getBaseTokenHoldings(wallet.address, trackedTokens);
    nativeBalance = await base.getEthBalance(wallet.address);
  }

  const nativeSymbol = network === 'solana' ? 'SOL' : 'ETH';
  const nativeAmount =
    network === 'solana'
      ? nativeBalance.sol.toFixed(4)
      : parseFloat(nativeBalance.eth).toFixed(4);

  let message = `📊 *${network === 'solana' ? 'Solana ☀️' : 'Base 🔵'} Holdings*\n\n`;
  message += `💎 *${nativeSymbol}:* ${nativeAmount} ($${nativeBalance.usd.toFixed(2)})\n\n`;

  if (holdings.length === 0) {
    message += '_No token holdings found_';
  } else {
    const totalValue = holdings.reduce(
      (sum: number, h: any) => sum + parseFloat(h.valueUsd),
      0
    );
    message += `*Tokens:* ${holdings.length}\n`;
    message += `*Total Value:* $${totalValue.toFixed(2)}\n\n`;
    message += 'Select a token to view details or sell:';
  }

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboards.getHoldingsKeyboard(holdings, network, page),
  });
  await ctx.answerCbQuery();
}

async function showHoldingDetail(
  ctx: Context,
  network: Network,
  tokenAddress: string
): Promise<void> {
  const userId = ctx.from!.id;
  const wallet = db.getWallet(userId, network);
  if (!wallet) return;

  const tokenInfo = await dexscreener.getTokenInfo(tokenAddress, network);
  if (!tokenInfo) {
    await ctx.answerCbQuery('Token info not available');
    return;
  }

  let balance: string;
  if (network === 'solana') {
    const holdings = await solana.getSolanaTokenHoldings(wallet.address);
    const holding = holdings.find(
      (h: any) => h.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    );
    balance = holding?.balanceFormatted || '0';
  } else {
    const { balance: bal, decimals } = await base.getTokenBalance(
      wallet.address,
      tokenAddress
    );
    balance = formatters.formatTokenAmount(bal.toString(), decimals);
  }

  const value = parseFloat(balance) * parseFloat(tokenInfo.priceUsd);

  const message =
    dexscreener.formatTokenInfoMessage(tokenInfo) +
    `\n\n*Your Balance:* ${balance} ${tokenInfo.symbol}\n` +
    `*Value:* $${value.toFixed(2)}`;

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboards.getSellAmountKeyboard(network, tokenAddress, tokenInfo.symbol),
  });
  await ctx.answerCbQuery();
}

// ════════════════════════════════════════════════════════
//  BUY
// ════════════════════════════════════════════════════════

async function showBuyNetworkSelect(ctx: Context): Promise<void> {
  await ctx.editMessageText(
    '🛒 *Buy Token*\n\nSelect a network or paste a token contract address:',
    { parse_mode: 'Markdown', ...keyboards.getNetworkSelectionKeyboard('buy') }
  );
  await ctx.answerCbQuery();
}

async function startBuyOnNetwork(ctx: Context, network: Network): Promise<void> {
  const userId = ctx.from!.id;
  setUserState(userId, { selectedNetwork: network, currentAction: 'buying' });
  await ctx.editMessageText(
    `🛒 *Buy Token on ${network === 'solana' ? 'Solana' : 'Base'}*\n\nPaste a token contract address to get started:`,
    { parse_mode: 'Markdown' }
  );
  await ctx.answerCbQuery();
}

async function showBuyAmountSelection(
  ctx: Context,
  network: Network,
  tokenAddress: string
): Promise<void> {
  await ctx.editMessageText(
    '💰 *Select Buy Amount*\n\nHow much do you want to spend?',
    { parse_mode: 'Markdown', ...keyboards.getBuyAmountKeyboard(network, tokenAddress) }
  );
  await ctx.answerCbQuery();
}

async function handleBuyAmount(
  ctx: Context,
  network: Network,
  tokenAddress: string,
  amount: number
): Promise<void> {
  await executeBuy(ctx, network, tokenAddress, amount);
  await ctx.answerCbQuery();
}

async function handleBuyPercent(
  ctx: Context,
  network: Network,
  tokenAddress: string,
  percent: number
): Promise<void> {
  const userId = ctx.from!.id;
  const wallet = db.getWallet(userId, network);
  if (!wallet) {
    await ctx.answerCbQuery('No wallet found');
    return;
  }

  let balance: number;
  if (network === 'solana') {
    const bal = await solana.getSolBalance(wallet.address);
    balance = bal.sol * (percent / 100);
  } else {
    const bal = await base.getEthBalance(wallet.address);
    balance = parseFloat(bal.eth) * (percent / 100);
  }

  await executeBuy(ctx, network, tokenAddress, balance);
  await ctx.answerCbQuery();
}

async function startBuyCustomAmount(
  ctx: Context,
  network: Network,
  tokenAddress: string
): Promise<void> {
  const userId = ctx.from!.id;
  setUserState(userId, {
    currentAction: 'buying',
    pendingTrade: {
      userId,
      chatId: ctx.chat!.id,
      tokenAddress,
      tokenInfo: {} as any,
      network,
      action: 'buy',
      stage: 'select_amount',
    },
  });

  const symbol = network === 'solana' ? 'SOL' : 'ETH';
  await ctx.editMessageText(
    `✏️ *Enter Custom Amount*\n\nPlease type the amount of ${symbol} you want to spend:`,
    { parse_mode: 'Markdown' }
  );
  await ctx.answerCbQuery();
}

// ════════════════════════════════════════════════════════
//  SELL
// ════════════════════════════════════════════════════════

async function showSellNetworkSelect(ctx: Context): Promise<void> {
  await ctx.editMessageText(
    '💸 *Sell Token*\n\nSelect a network to view holdings:',
    { parse_mode: 'Markdown', ...keyboards.getNetworkSelectionKeyboard('sell') }
  );
  await ctx.answerCbQuery();
}

async function handleSellPercent(
  ctx: Context,
  network: Network,
  tokenAddress: string,
  percent: number
): Promise<void> {
  await executeSell(ctx, network, tokenAddress, percent);
  await ctx.answerCbQuery();
}

// ════════════════════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════════════════════

async function showSettingsNetworkSelect(ctx: Context): Promise<void> {
  await ctx.editMessageText(
    '⚙️ *Settings*\n\nSelect a network:',
    { parse_mode: 'Markdown', ...keyboards.getNetworkSelectionKeyboard('settings') }
  );
  await ctx.answerCbQuery();
}

async function showSettings(ctx: Context, network: Network): Promise<void> {
  const userId = ctx.from!.id;
  const settings = db.getTradeSettings(userId, network);

  const message =
    `⚙️ *${network === 'solana' ? 'Solana' : 'Base'} Settings*\n\n` +
    `*Slippage:* ${settings.slippageBps / 100}%\n` +
    (network === 'solana'
      ? `*Priority Fee:* ${settings.priorityFeeLamports} lamports\n`
      : '') +
    '\nSelect a setting to modify:';

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboards.getSettingsKeyboard(network),
  });
  await ctx.answerCbQuery();
}

async function showSlippageMenu(ctx: Context, network: Network): Promise<void> {
  await ctx.editMessageText(
    '📊 *Slippage Settings*\n\nSelect your preferred slippage tolerance:',
    { parse_mode: 'Markdown', ...keyboards.getSlippageKeyboard(network) }
  );
  await ctx.answerCbQuery();
}

async function setSlippage(
  ctx: Context,
  network: Network,
  value: number
): Promise<void> {
  const userId = ctx.from!.id;
  const settings = db.getTradeSettings(userId, network);
  settings.slippageBps = value;
  db.saveTradeSettings(settings);
  await ctx.answerCbQuery(`Slippage set to ${value / 100}%`);
  await showSettings(ctx, network);
}

// ════════════════════════════════════════════════════════
//  TOKEN
// ════════════════════════════════════════════════════════

async function refreshToken(
  ctx: Context,
  network: Network,
  tokenAddress: string
): Promise<void> {
  const tokenInfo = await dexscreener.getTokenInfo(tokenAddress, network);
  if (tokenInfo) {
    const message = dexscreener.formatTokenInfoMessage(tokenInfo);
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...keyboards.getQuickTradeKeyboard(network, tokenAddress),
    });
  }
  await ctx.answerCbQuery();
}

// ════════════════════════════════════════════════════════
//  CONFIRM
// ════════════════════════════════════════════════════════

async function handleConfirm(ctx: Context, parts: string[]): Promise<void> {
  // Handle various confirmation actions
  await ctx.answerCbQuery();
}

// ════════════════════════════════════════════════════════
//  LEGACY HANDLERS (for inline keyboards with old-style data)
// ════════════════════════════════════════════════════════

async function handleLegacyWallet(ctx: Context, parts: string[]): Promise<void> {
  const subAction = parts[1];
  const network = parts[2] as Network;

  switch (subAction) {
    case 'create':
      await createWallet(ctx, network);
      break;
    case 'import':
      await startWalletImport(ctx, network);
      break;
    default:
      await ctx.answerCbQuery();
  }
}

async function handleLegacyMenu(ctx: Context, parts: string[]): Promise<void> {
  const subAction = parts[1];
  switch (subAction) {
    case 'main':
      await showMainMenu(ctx);
      break;
    case 'wallet':
      await showWalletNetworkSelect(ctx);
      break;
    default:
      await showMainMenu(ctx);
  }
}

// ————————————————————————————————————————
// Withdraw Functions
// ————————————————————————————————————————

async function showWithdrawOptions(ctx: Context, network: Network): Promise<void> {
  const ns = network === 'solana' ? 'sol' : 'bas';
  const nativeName = network === 'solana' ? 'SOL' : 'ETH';
  const emoji = network === 'solana' ? '☀️' : '����';

  await ctx.editMessageText(
    `������ *${emoji} ${network === 'solana' ? 'Solana' : 'Base'} Withdraw*\n\nWhat would you like to withdraw?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`${emoji} Withdraw ${nativeName}`, `wwn:${ns}`)],
        [Markup.button.callback('������ Withdraw Token', `wwt:${ns}`)],
        [Markup.button.callback('�� Back', `wn:${ns}`)],
      ])
    }
  );
}

async function startWithdrawNative(ctx: Context, network: Network): Promise<void> {
  const userId = ctx.from!.id;
  const nativeName = network === 'solana' ? 'SOL' : 'ETH';
  const gasReserve = network === 'solana' ? '0.01' : '0.0005';

  setUserState(userId, {
    currentAction: 'withdrawing',
    pendingWithdraw: {
      network,
      tokenAddress: 'native',
      tokenSymbol: nativeName,
      stage: 'enter_address',
    },
  });

  await ctx.editMessageText(
    `«���� *Withdraw ${nativeName}*\n\n` +
    `��⚠️ A reserve of ${gasReserve} ${nativeName} will be kept for gas fees.\n\n` +
    `Please paste the destination wallet address:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'wwx')],
      ])
    }
  );
}

async function showWithdrawTokenList(ctx: Context, network: Network): Promise<void> {
  const userId = ctx.from!.id;
  const wallet = db.getWallet(userId, network);
  if (!wallet) {
    await ctx.answerCbQuery('No wallet found');
    return;
  }

  const ns = network === 'solana' ? 'sol' : 'bas';

  try {
    let holdings: any[] = [];
    if (network === 'solana') {
      holdings = await solana.getSolanaTokenHoldings(wallet.address);
    } else {
      const trackedTokens = db.getTrackedTokens(userId, network);
      holdings = await base.getBaseTokenHoldings(wallet.address, trackedTokens);
    }

    // Filter out native and zero-balance tokens
    const tokens = holdings.filter((h: any) => {
      if (network === 'solana') return parseFloat(h.balance) > 0;
      // For Base, filter out native ETH (address is zero or undefined) and USDC with 0 balance
      return parseFloat(h.balance) > 0 && h.tokenAddress && h.tokenAddress !== '0x0000000000000000000000000000000000000000';
    });

    if (tokens.length === 0) {
      await ctx.editMessageText(
        '❌ No tokens found to withdraw.\n\nYou have no token holdings with a balance.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('« Back', `ww:${ns}`)],
          ])
        }
      );
      return;
    }

    const buttons = tokens.map((t: any) => {
      const addr = t.address || t.mint;
      const short = keyboards.shortenToken(addr);
      return [Markup.button.callback(
        `${t.symbol || 'Unknown'} — ${t.balance.toFixed(4)}`,
        `wwts:${ns}:${short}`
      )];
    });
    buttons.push([Markup.button.callback('« Back', `ww:${ns}`)]);

    await ctx.editMessageText(
      '���� *Select a token to withdraw:*',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      }
    );
  } catch (err) {
    console.error('Error loading token list for withdraw:', err);
    await ctx.editMessageText(
      '��❌ Error loading token holdings. Please try again.',
      { ...Markup.inlineKeyboard([[Markup.button.callback('« Back', `ww:${ns}`)]]) }
    );
  }
}

async function startWithdrawToken(ctx: Context, network: Network, tokenAddress: string): Promise<void> {
  const userId = ctx.from!.id;
  const wallet = db.getWallet(userId, network);
  if (!wallet) {
    await ctx.answerCbQuery('No wallet found');
    return;
  }

  let symbol = 'Token';
  let decimals = 18;

  try {
    if (network === 'base') {
      const holdings = await base.getBaseTokenHoldings(wallet.address, [tokenAddress]);
      const matchBase = holdings.find((h: any) => h.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase()); symbol = matchBase?.symbol || 'Token';
      decimals = matchBase?.decimals || 18;
    } else {
      // For Solana, try to get token info from holdings
      const holdings = await solana.getSolanaTokenHoldings(wallet.address);
      const match = holdings.find((h: any) => h.mint === tokenAddress);
      if (match) {
        symbol = match.symbol || 'Token';
        decimals = match.decimals || 9;
      }
    }
  } catch (err) {
    console.error('Error getting token info for withdraw:', err);
  }

  setUserState(userId, {
    currentAction: 'withdrawing',
    pendingWithdraw: {
      network,
      tokenAddress,
      tokenSymbol: symbol,
      tokenDecimals: decimals,
      stage: 'enter_address',
    },
  });

  await ctx.editMessageText(
    `���� *Withdraw ${symbol}*\n\nPlease paste the destination wallet address:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('��❌ Cancel', 'wwx')],
      ])
    }
  );
}

async function executeWithdraw(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const state = getUserState(userId);
  const pw = state.pendingWithdraw;
  if (!pw || !pw.toAddress || !pw.amount) {
    await ctx.answerCbQuery('Invalid withdraw state');
    return;
  }

  await ctx.editMessageText('⏳ Processing withdrawal...');

  try {
    let result: any;

    if (pw.network === 'solana') {
      if (pw.tokenAddress === 'native') {
        result = await solana.withdrawSol(userId, pw.toAddress, pw.amount);
      } else {
        result = await solana.withdrawSplToken(userId, pw.tokenAddress!, pw.toAddress, pw.amount, pw.tokenDecimals || 9);
      }
    } else {
      if (pw.tokenAddress === 'native') {
        result = await base.withdrawEth(userId, pw.toAddress, pw.amount);
      } else {
        result = await base.withdrawErc20Token(userId, pw.tokenAddress!, pw.toAddress, pw.amount, pw.tokenDecimals || 18);
      }
    }

    clearUserState(userId);

    const explorer = pw.network === 'solana'
      ? `https://solscan.io/tx/${result.signature}`
      : `https://basescan.org/tx/${result.signature}`;

    await ctx.editMessageText(
      `✅ *Withdrawal Successful!*\n\n` +
      `${result.message}\n` +
      `To: \`${pw.toAddress}\`\n\n` +
      `[View Transaction](${explorer})`,
      {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        ...Markup.inlineKeyboard([
          [Markup.button.callback('« Main Menu', 'm')],
        ])
      }
    );
  } catch (err: any) {
    clearUserState(userId);
    console.error('Withdraw error:', err);
    await ctx.editMessageText(
      `❌ *Withdrawal Failed*\n\n${err.message || 'Unknown error'}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('« Main Menu', 'm')],
        ])
      }
    );
  }
}


// ==================== Withdraw Functions ====================

async function showWithdrawMenu(ctx: Context, network: Network): Promise<void> {
  const userId = ctx.from?.id;
  const wallet = db.getWallet(userId, network);

  const ns = network === 'solana' ? 'sol' : 'bas';
  const emoji = network === 'solana' ? '☀️' : '🔵';
  const nativeSymbol = network === 'solana' ? 'SOL' : 'ETH';

  const buttons: any[][] = [
    [Markup.button.callback(emoji + ' ' + nativeSymbol + ' (Native)', 'wdt:' + ns + ':native')],
  ];

  try {
    if (network === 'solana') {
      const holdings = await solana.getSolanaTokenHoldings(wallet.address);
      for (const h of holdings) {
        if (parseFloat(h.balance) > 0) {
          const label = h.symbol || h.tokenAddress.slice(0, 6);
          const tokenShort = keyboards.shortenToken(h.tokenAddress);
          buttons.push([Markup.button.callback('🪙 ' + label + ' (' + parseFloat(h.balanceFormatted).toFixed(4) + ')', 'wdt:' + ns + ':' + tokenShort)]);
        }
      }
    } else {
      const trackedTokens = db.getTrackedTokens(userId, network);
      const holdings = await base.getBaseTokenHoldings(wallet.address, trackedTokens);
      for (const h of holdings) {
        if (parseFloat(h.balance) > 0 && h.tokenAddress !== '0x0000000000000000000000000000000000000000') {
          const label = h.symbol || h.tokenAddress.slice(0, 6);
          const tokenShort = keyboards.shortenToken(h.tokenAddress);
          buttons.push([Markup.button.callback('🪙 ' + label + ' (' + parseFloat(h.balanceFormatted).toFixed(4) + ')', 'wdt:' + ns + ':' + tokenShort)]);
        }
      }
    }
  } catch (e) { console.error('Error loading holdings for withdraw:', e); }

  buttons.push([Markup.button.callback('❌ Cancel', 'wdx')]);
  const netLabel = network === 'solana' ? 'Solana ☀️' : 'Base 🔵';
  await ctx.editMessageText('💸 *Withdraw from ' + netLabel + ' Wallet*\n\nSelect token to withdraw:', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function startWithdrawAddress(ctx: Context, network: Network, tokenShortOrNative?: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  let tokenAddress: string | undefined;
  let tokenSymbol: string;
  let tokenDecimals: number;
  let nativeWarning = '';

  if (!tokenShortOrNative || tokenShortOrNative === 'native') {
    // Native token (SOL or ETH)
    tokenAddress = undefined;
    tokenSymbol = network === 'solana' ? 'SOL' : 'ETH';
    tokenDecimals = network === 'solana' ? 9 : 18;
    const gasReserve = network === 'solana' ? '0.01 SOL' : '0.0005 ETH';
    nativeWarning = `\n\n⚠️ A reserve of ${gasReserve} will be kept for gas fees.`;
  } else {
    // SPL token or ERC20
    tokenAddress = keyboards.expandToken(tokenShortOrNative);
    if (!tokenAddress) {
      await ctx.answerCbQuery('Token not found');
      return;
    }
    // Try to get token info from holdings
    const wallet = db.getWallet(userId, network);
    if (wallet) {
      try {
        if (network === 'solana') {
          const holdings = await solana.getSolanaTokenHoldings(wallet.address);
          const match = holdings.find((h: any) => h.tokenAddress?.toLowerCase() === tokenAddress?.toLowerCase());
          tokenSymbol = match?.symbol || tokenAddress.slice(0, 8);
          tokenDecimals = match?.decimals || 9;
        } else {
          const trackedTokens = db.getTrackedTokens(userId, network);
          const holdings = await base.getBaseTokenHoldings(wallet.address, trackedTokens);
          const match = holdings.find((h: any) => h.tokenAddress?.toLowerCase() === tokenAddress?.toLowerCase());
          tokenSymbol = match?.symbol || tokenAddress.slice(0, 8);
          tokenDecimals = match?.decimals || 18;
        }
      } catch {
        tokenSymbol = tokenAddress.slice(0, 8);
        tokenDecimals = network === 'solana' ? 9 : 18;
      }
    } else {
      tokenSymbol = tokenAddress.slice(0, 8);
      tokenDecimals = network === 'solana' ? 9 : 18;
    }
  }

  setUserState(userId, {
    currentAction: 'withdrawing',
    pendingWithdraw: { network, tokenAddress, tokenSymbol, tokenDecimals, stage: 'enter_address' },
  });

  await ctx.editMessageText(
    '💸 *Withdraw ' + tokenSymbol + '*\n\nPlease type the destination wallet address:' + nativeWarning,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'wdx')]]) }
  );
  await ctx.answerCbQuery();
}

async function executeWithdrawAction(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const state = getUserState(userId);
  const pw = state.pendingWithdraw;

  if (!pw || !pw.toAddress || !pw.amount) {
    await ctx.answerCbQuery('Invalid withdraw state');
    return;
  }

  await ctx.editMessageText('⏳ Processing withdrawal...');

  try {
    let result;
    if (pw.network === 'solana') {
      if (!pw.tokenAddress) {
        // Native SOL
        result = await solana.withdrawSol(userId, pw.toAddress, pw.amount);
      } else {
        // SPL Token
        result = await solana.withdrawSplToken(userId, pw.tokenAddress, pw.toAddress, pw.amount, pw.tokenDecimals || 9);
      }
    } else {
      if (!pw.tokenAddress) {
        // Native ETH
        result = await base.withdrawEth(userId, pw.toAddress, pw.amount);
      } else {
        // ERC20 Token
        result = await base.withdrawErc20Token(userId, pw.tokenAddress, pw.toAddress, pw.amount, pw.tokenDecimals || 18);
      }
    }

    clearUserState(userId);

    if (result.success) {
      const explorer = pw.network === 'solana'
        ? 'https://solscan.io/tx/' + result.signature
        : 'https://basescan.org/tx/' + result.signature;
      await ctx.editMessageText(
        '✅ *Withdrawal Successful!*\n\n' + result.message + '\nTo: `' + pw.toAddress + '`\n\n[View Transaction](' + explorer + ')',
        { parse_mode: 'Markdown', link_preview_options: { is_disabled: true }, ...keyboards.getMainMenuKeyboard() }
      );
    } else {
      await ctx.editMessageText(
        '❌ *Withdrawal Failed*\n\n' + (result.error || 'Unknown error'),
        { parse_mode: 'Markdown', ...keyboards.getMainMenuKeyboard() }
      );
    }
  } catch (error: any) {
    clearUserState(userId);
    await ctx.editMessageText(
      '❌ *Withdrawal Failed*\n\n' + (error.message || 'Unknown error'),
      { parse_mode: 'Markdown', ...keyboards.getMainMenuKeyboard() }
    );
  }
}
