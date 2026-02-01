import { Context, Telegraf, Markup } from 'telegraf';
import { Message } from 'telegraf/types';
import { Network, TokenInfo, UserState } from '../types';
import { config } from '../config';
import * as db from '../services/database';
import * as solana from '../services/solana';
import * as base from '../services/base';
import * as dexscreener from '../services/dexscreener';
import * as keyboards from '../utils/keyboards';
import * as formatters from '../utils/formatters';
import { handleSecurityTextInput } from './security-handlers';

// User states for conversation flow
const userStates = new Map<number, UserState>();

export function getUserState(userId: number): UserState {
  if (!userStates.has(userId)) {
    userStates.set(userId, {});
  }
  return userStates.get(userId)!;
}

export function setUserState(userId: number, state: Partial<UserState>): void {
  const current = getUserState(userId);
  userStates.set(userId, { ...current, ...state });
}

export function clearUserState(userId: number): void {
  userStates.delete(userId);
}

/**
 * /start command handler
 */
export async function handleStart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  const welcomeMessage = `
🚀 *Welcome to the Trading Bot\\!*

Trade tokens on *Solana* and *Base* networks directly from Telegram\\.

*Features:*
• 💰 Integrated wallet management
• 🔄 Swap tokens via Jupiter \\(Solana\\) & 1inch/LlamaSwap \\(Base\\)
• 📊 Real\\-time token info from DexScreener
• 💼 Track your holdings and portfolio value

*Quick Start:*
1️⃣ Paste a token contract address to get info
2️⃣ Or use the menu below to navigate

⚠️ *Security Reminder:* Your private keys are encrypted and stored locally\\. Never share your private key with anyone\\!
`;
  
  await ctx.reply(welcomeMessage, {
    parse_mode: 'MarkdownV2',
    ...keyboards.getMainMenuKeyboard(),
  });
}

/**
 * /help command handler
 */
export async function handleHelp(ctx: Context): Promise<void> {
  const helpMessage = `
📚 *Trading Bot Help*

*Commands:*
/start \\- Show main menu
/wallet \\- Manage your wallets
/holdings \\- View token holdings
/buy \\- Buy a token
/sell \\- Sell a token
/settings \\- Configure settings
/history \\- View transaction history
/help \\- Show this help

*How to Trade:*
1\\. Simply paste a token contract address
2\\. The bot will show token info for verification
3\\. Choose your buy/sell amount
4\\. Confirm the transaction

*Supported Networks:*
• ☀️ Solana \\- via Jupiter aggregator
• 🔵 Base \\- via 1inch/LlamaSwap

*Tips:*
• Set your slippage in settings
• Start with small amounts
• Always verify token addresses
`;
  
  await ctx.reply(helpMessage, {
    parse_mode: 'MarkdownV2',
    ...keyboards.getMainMenuKeyboard(),
  });
}

/**
 * /wallet command handler
 */
export async function handleWallet(ctx: Context): Promise<void> {
  await ctx.reply(
    '💰 *Wallet Management*\n\nSelect a network to manage your wallet:',
    {
      parse_mode: 'Markdown',
      ...keyboards.getNetworkSelectionKeyboard('wallet'),
    }
  );
}

/**
 * /holdings command handler
 */
export async function handleHoldings(ctx: Context): Promise<void> {
  await ctx.reply(
    '📊 *Token Holdings*\n\nSelect a network to view your holdings:',
    {
      parse_mode: 'Markdown',
      ...keyboards.getNetworkSelectionKeyboard('holdings'),
    }
  );
}

/**
 * /buy command handler
 */
export async function handleBuy(ctx: Context): Promise<void> {
  await ctx.reply(
    '🛒 *Buy Token*\n\nSelect a network or paste a token contract address:',
    {
      parse_mode: 'Markdown',
      ...keyboards.getNetworkSelectionKeyboard('buy'),
    }
  );
}

/**
 * /sell command handler
 */
export async function handleSell(ctx: Context): Promise<void> {
  await ctx.reply(
    '💸 *Sell Token*\n\nSelect a network to view your holdings and sell:',
    {
      parse_mode: 'Markdown',
      ...keyboards.getNetworkSelectionKeyboard('sell'),
    }
  );
}

/**
 * /settings command handler
 */
export async function handleSettings(ctx: Context): Promise<void> {
  await ctx.reply(
    '⚙️ *Settings*\n\nSelect a network to configure:',
    {
      parse_mode: 'Markdown',
      ...keyboards.getNetworkSelectionKeyboard('settings'),
    }
  );
}

/**
 * /history command handler
 */
export async function handleHistory(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  const transactions = db.getRecentTransactions(userId, 10);
  
  if (transactions.length === 0) {
    await ctx.reply('📜 *Transaction History*\n\nNo transactions yet.', {
      parse_mode: 'Markdown',
      ...keyboards.getMainMenuKeyboard(),
    });
    return;
  }
  
  let message = '📜 *Recent Transactions*\n\n';
  
  for (const tx of transactions) {
    const emoji = tx.action === 'buy' ? '🛒' : '💸';
    const network = tx.network === 'solana' ? '☀️' : '🔵';
    const date = new Date(tx.created_at).toLocaleDateString();
    
    message += `${emoji} ${network} ${tx.action.toUpperCase()} ${tx.token_symbol || 'Token'}\n`;
    message += `   ${formatters.truncateAddress(tx.tx_hash)} | ${date}\n\n`;
  }
  
  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...keyboards.getMainMenuKeyboard(),
  });
}

/**
 * Handle text messages (token addresses)
 */
export async function handleTextMessage(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  const message = ctx.message as Message.TextMessage;
  const text = message.text.trim();
  
  // Check if user is in a specific input state
  const state = getUserState(userId);
  
  
  // Handle security flows first
  if (await handleSecurityTextInput(ctx, text)) return;
  // Handle withdraw flow text input
  if (state.currentAction === 'withdrawing' && state.pendingWithdraw) {
    await handleWithdrawTextInput(ctx, text);
    return;
  }

  if (state.currentAction === 'buying' && state.pendingTrade?.stage === 'select_amount') {
    // Handle custom amount input
    await handleCustomBuyAmount(ctx, text);
    return;
  }

  // Handle withdraw address input
  if (state.currentAction === 'withdrawing' && state.pendingWithdraw?.stage === 'enter_address') {
    await handleWithdrawAddressInput(ctx, text);
    return;
  }

  // Handle withdraw amount input
  if (state.currentAction === 'withdrawing' && state.pendingWithdraw?.stage === 'enter_amount') {
    await handleWithdrawAmountInput(ctx, text);
    return;
  }
  
  // Try to detect if this is a token address
  const network = formatters.detectNetworkFromAddress(text);
  
  if (network) {
    // User pasted a token address
    await handleTokenAddressInput(ctx, text, network);
    return;
  }
  
  // Check if it's a private key import (starts with a specific pattern)
  if (state.currentAction === 'settings') {
    // Handle private key import
    await handlePrivateKeyImport(ctx, text);
    return;
  }
  
  // Unknown input
  await ctx.reply(
    '🤔 I didn\'t understand that. Please use the menu or paste a valid token contract address.',
    keyboards.getMainMenuKeyboard()
  );
}

/**
 * Handle token address input
 */
/**
 * Handle text input during withdraw flow (address and amount)
 */
async function handleWithdrawTextInput(ctx: Context, text: string): Promise<void> {
  const userId = ctx.from!.id;
  const state = getUserState(userId);
  const pw = state.pendingWithdraw!;

  if (pw.stage === 'enter_address') {
    // Validate address format
    if (pw.network === 'solana') {
      // Solana addresses are base58, 32-44 chars
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) {
        await ctx.reply('❌ Invalid Solana address. Please paste a valid address:');
        return;
      }
    } else {
      // Base/ETH addresses start with 0x, 42 chars
      if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
        await ctx.reply('❌ Invalid Base/ETH address. Please paste a valid address:');
        return;
      }
    }

    // Save address and ask for amount
    setUserState(userId, {
      currentAction: 'withdrawing',
      pendingWithdraw: { ...pw, toAddress: text, stage: 'enter_amount' },
    });

    const nativeName = pw.network === 'solana' ? 'SOL' : 'ETH';
    const isNative = pw.tokenAddress === 'native';

    await ctx.reply(
      `✅ Destination: \`${text}\`\n\n` +
      `Enter the amount of ${pw.tokenSymbol || 'tokens'} to withdraw` +
      (isNative ? ` (or type "all" to withdraw max minus gas reserve):` : ` (or type "all" for full balance):`),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('���� Withdraw All', 'wwa')],
          [Markup.button.callback('��❌ Cancel', 'wwx')],
        ])
      }
    );
    return;
  }

  if (pw.stage === 'enter_amount') {
    // Validate amount
    const isAll = text.toLowerCase() === 'all';
    if (!isAll && (isNaN(parseFloat(text)) || parseFloat(text) <= 0)) {
      await ctx.reply('❌ Invalid amount. Please enter a positive number or "all":');
      return;
    }

    const amount = isAll ? 'all' : text;
    const gasNote = pw.tokenAddress === 'native'
      ? `\n⚠️ Gas reserve will be kept automatically.`
      : '';

    // Save amount and show confirmation
    setUserState(userId, {
      currentAction: 'withdrawing',
      pendingWithdraw: { ...pw, amount, stage: 'confirm' },
    });

    await ctx.reply(
      `���� *Confirm Withdrawal*\n\n` +
      `Token: *${pw.tokenSymbol}*\n` +
      `Amount: *${amount}*\n` +
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
    return;
  }
}

async function handleTokenAddressInput(
  ctx: Context, 
  address: string, 
  network: Network
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  await ctx.reply('🔍 Fetching token information...');
  
  const tokenInfo = await dexscreener.getTokenInfo(address, network);
  
  if (!tokenInfo) {
    await ctx.reply(
      '❌ Token not found or has no liquidity.\n\nPlease verify the address and try again.',
      keyboards.getMainMenuKeyboard()
    );
    return;
  }
  
  // Display token info
  const infoMessage = dexscreener.formatTokenInfoMessage(tokenInfo);
  
  // Save pending trade state
  setUserState(userId, {
    currentAction: 'buying',
    pendingTrade: {
      userId,
      chatId: ctx.chat!.id,
      tokenAddress: address,
      tokenInfo,
      network,
      action: 'buy',
      stage: 'confirm_token',
    },
  });
  
  await ctx.reply(
    infoMessage + '\n\n*Is this the correct token?*',
    {
      parse_mode: 'Markdown',
      ...keyboards.getTokenConfirmKeyboard(network, address),
    }
  );
}

/**
 * Handle custom buy amount input
 */
async function handleCustomBuyAmount(ctx: Context, amountStr: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  const state = getUserState(userId);
  const trade = state.pendingTrade;
  
  if (!trade) {
    await ctx.reply('Session expired. Please start again.', keyboards.getMainMenuKeyboard());
    clearUserState(userId);
    return;
  }
  
  const amount = formatters.parseAmount(amountStr);
  
  if (!amount || amount <= 0) {
    await ctx.reply('❌ Invalid amount. Please enter a valid number (e.g., 0.5, 1.5, 100):');
    return;
  }
  
  // Execute the buy
  await executeBuy(ctx, trade.network, trade.tokenAddress, amount);
}

/**
 * Handle private key import
 */
async function handlePrivateKeyImport(ctx: Context, privateKey: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  const state = getUserState(userId);
  const network = state.selectedNetwork;
  
  if (!network) {
    await ctx.reply('Please select a network first.', keyboards.getMainMenuKeyboard());
    clearUserState(userId);
    return;
  }
  
  // Delete the message containing private key for security
  try {
    await ctx.deleteMessage();
  } catch (e) {
    // May fail if bot doesn't have delete permissions
  }
  
  await ctx.reply('🔐 Importing wallet...');
  
  let result;
  if (network === 'solana') {
    result = await solana.importSolanaWallet(userId, privateKey);
  } else {
    result = await base.importBaseWallet(userId, privateKey);
  }
  
  if (result.success) {
    await ctx.reply(
      `✅ Wallet imported successfully!\n\n` +
      `*Address:*\n\`${result.address}\`\n\n` +
      `⚠️ Your private key has been encrypted and stored securely.`,
      {
        parse_mode: 'Markdown',
        ...keyboards.getMainMenuKeyboard(),
      }
    );
  } else {
    await ctx.reply(
      `❌ Failed to import wallet: ${result.error}`,
      keyboards.getMainMenuKeyboard()
    );
  }
  
  clearUserState(userId);
}

/**
 * Execute a buy transaction
 */
export async function executeBuy(
  ctx: Context,
  network: Network,
  tokenAddress: string,
  amount: number
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  // Check wallet exists
  const wallet = db.getWallet(userId, network);
  if (!wallet) {
    await ctx.reply(
      `❌ No ${network} wallet found. Please create one first.`,
      keyboards.getWalletMenuKeyboard(network)
    );
    return;
  }
  
  const settings = db.getTradeSettings(userId, network);
  const nativeSymbol = network === 'solana' ? 'SOL' : 'ETH';
  
  await ctx.reply(`⏳ Executing buy for ${amount} ${nativeSymbol}...`);
  
  let result;
  if (network === 'solana') {
    result = await solana.buySolanaToken(
      userId,
      tokenAddress,
      amount,
      settings.slippageBps
    );
  } else {
    result = await base.buyBaseToken(
      userId,
      tokenAddress,
      amount,
      settings.slippageBps
    );
  }
  
  if (result.success) {
    // Record transaction
    db.recordTransaction(
      userId,
      network,
      result.signature || result.hash || '',
      'buy',
      tokenAddress,
      '',
      amount.toString(),
      '',
    );
    
    await ctx.reply(
      `✅ *Buy Successful!*\n\n` +
      `💰 Spent: ${amount} ${nativeSymbol}\n` +
      `🔗 [View Transaction](${result.explorerUrl})`,
      {
        parse_mode: 'Markdown',
        ...keyboards.getTransactionResultKeyboard(result.explorerUrl, network),
      }
    );
  } else {
    await ctx.reply(
      `❌ *Buy Failed*\n\n${result.error}`,
      {
        parse_mode: 'Markdown',
        ...keyboards.getMainMenuKeyboard(),
      }
    );
  }
  
  clearUserState(userId);
}

/**
 * Execute a sell transaction
 */
export async function executeSell(
  ctx: Context,
  network: Network,
  tokenAddress: string,
  percentage: number
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  
  const settings = db.getTradeSettings(userId, network);
  const nativeSymbol = network === 'solana' ? 'SOL' : 'ETH';
  
  await ctx.reply(`⏳ Selling ${percentage}% of holdings...`);
  
  let result;
  if (network === 'solana') {
    result = await solana.sellSolanaTokenPercentage(
      userId,
      tokenAddress,
      percentage,
      settings.slippageBps
    );
  } else {
    result = await base.sellBaseTokenPercentage(
      userId,
      tokenAddress,
      percentage,
      settings.slippageBps
    );
  }
  
  if (result.success) {
    // Record transaction
    db.recordTransaction(
      userId,
      network,
      result.signature || result.hash || '',
      'sell',
      tokenAddress,
      '',
      percentage.toString(),
      '',
    );
    
    await ctx.reply(
      `✅ *Sell Successful!*\n\n` +
      `💸 Sold: ${percentage}% of holdings\n` +
      `🔗 [View Transaction](${result.explorerUrl})`,
      {
        parse_mode: 'Markdown',
        ...keyboards.getTransactionResultKeyboard(result.explorerUrl, network),
      }
    );
  } else {
    await ctx.reply(
      `❌ *Sell Failed*\n\n${result.error}`,
      {
        parse_mode: 'Markdown',
        ...keyboards.getMainMenuKeyboard(),
      }
    );
  }
  
  clearUserState(userId);
}


async function handleWithdrawAddressInput(ctx: Context, address: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const state = getUserState(userId);
  const pw = state.pendingWithdraw;
  if (!pw) return;

  const isValidSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  const isValidEvm = /^0x[a-fA-F0-9]{40}$/.test(address);

  if (pw.network === 'solana' && !isValidSolana) {
    await ctx.reply('Invalid Solana address. Please enter a valid Solana wallet address:');
    return;
  }
  if (pw.network === 'base' && !isValidEvm) {
    await ctx.reply('Invalid Base address. Please enter a valid 0x address:');
    return;
  }

  setUserState(userId, {
    currentAction: 'withdrawing',
    pendingWithdraw: { ...pw, toAddress: address, stage: 'enter_amount' },
  });

  let balanceStr = '';
  try {
    const wallet = db.getWallet(userId, pw.network);
    if (wallet) {
      if (!pw.tokenAddress) {
        if (pw.network === 'solana') {
          const bal = await solana.getSolBalance(wallet.address);
          balanceStr = '\nAvailable: ' + bal.sol.toFixed(4) + ' SOL';
        } else {
          const bal = await base.getEthBalance(wallet.address);
          balanceStr = '\nAvailable: ' + parseFloat(bal.eth).toFixed(6) + ' ETH';
        }
      } else if (pw.network === 'base') {
        const info = await base.getTokenBalance(pw.tokenAddress, wallet.address);
        balanceStr = '\nAvailable: ' + Number(info.balance).toFixed(4) + ' ' + pw.tokenSymbol;
      }
    }
  } catch {}

  await ctx.reply(
    '\ud83d\udcb8 *Withdraw ' + pw.tokenSymbol + '*\n\nTo: `' + address + '`' + balanceStr + '\n\nEnter the amount to withdraw (or type `all` for max):',
    { parse_mode: 'Markdown' }
  );
}

async function handleWithdrawAmountInput(ctx: Context, amountText: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const state = getUserState(userId);
  const pw = state.pendingWithdraw;
  if (!pw || !pw.toAddress) return;

  const isAll = amountText.toLowerCase() === 'all';
  if (!isAll) {
    const num = parseFloat(amountText);
    if (isNaN(num) || num <= 0) {
      await ctx.reply('Invalid amount. Enter a positive number or type `all`:', { parse_mode: 'Markdown' });
      return;
    }
  }

  const amount = isAll ? 'all' : amountText;
  setUserState(userId, {
    currentAction: 'withdrawing',
    pendingWithdraw: { ...pw, amount, stage: 'confirm' },
  });

  const nativeNote = !pw.tokenAddress ? '\n_\u26a0\ufe0f A small gas reserve will be kept in the wallet._' : '';
  const displayAmount = isAll ? 'ALL' : amountText;
  const netLabel = pw.network === 'solana' ? 'Solana' : 'Base';

  await ctx.reply(
    '\ud83d\udcb8 *Confirm Withdrawal*\n\nToken: *' + pw.tokenSymbol + '*\nAmount: *' + displayAmount + '*\nTo: `' + pw.toAddress + '`\nNetwork: *' + netLabel + '*' + nativeNote + '\n\nProceed?',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('\u2705 Confirm Withdraw', 'wdc')],
        [Markup.button.callback('\u274c Cancel', 'wdx')],
      ])
    }
  );
}
