import { Context } from 'telegraf';
import { Network } from '../types';
import { config } from '../config';
import * as db from '../services/database';
import * as solana from '../services/solana';
import * as base from '../services/base';
import * as dexscreener from '../services/dexscreener';
import * as keyboards from '../utils/keyboards';
import * as formatters from '../utils/formatters';
import { getUserState, setUserState, clearUserState, executeBuy, executeSell } from './commands';

/**
 * Main callback query handler
 */
export async function handleCallback(ctx: Context): Promise<void> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery || !('data' in callbackQuery)) return;
  
  const data = callbackQuery.data;
  const userId = ctx.from?.id;
  
  if (!userId) return;
  
  // Parse callback data
  const parts = data.split(':');
  const action = parts[0];
  
  try {
    switch (action) {
      case 'menu':
        await handleMenuCallback(ctx, parts);
        break;
      case 'wallet':
        await handleWalletCallback(ctx, parts);
        break;
      case 'holdings':
        await handleHoldingsCallback(ctx, parts);
        break;
      case 'holding':
        await handleHoldingCallback(ctx, parts);
        break;
      case 'buy':
        await handleBuyCallback(ctx, parts);
        break;
      case 'sell':
        await handleSellCallback(ctx, parts);
        break;
      case 'settings':
        await handleSettingsCallback(ctx, parts);
        break;
      case 'token':
        await handleTokenCallback(ctx, parts);
        break;
      case 'confirm':
        await handleConfirmCallback(ctx, parts);
        break;
      default:
        await ctx.answerCbQuery('Unknown action');
    }
  } catch (error) {
    console.error('Callback error:', error);
    await ctx.answerCbQuery('An error occurred');
  }
}

/**
 * Handle menu navigation callbacks
 */
async function handleMenuCallback(ctx: Context, parts: string[]): Promise<void> {
  const subAction = parts[1];
  const network = parts[2] as Network | undefined;
  
  switch (subAction) {
    case 'main':
      await ctx.editMessageText(
        '🚀 *Main Menu*\n\nWhat would you like to do?',
        {
          parse_mode: 'Markdown',
          ...keyboards.getMainMenuKeyboard(),
        }
      );
      break;
      
    case 'wallet':
      await ctx.editMessageText(
        '💰 *Wallet Management*\n\nSelect a network:',
        {
          parse_mode: 'Markdown',
          ...keyboards.getNetworkSelectionKeyboard('wallet'),
        }
      );
      break;
      
    case 'holdings':
      if (network) {
        await showHoldings(ctx, network);
      } else {
        await ctx.editMessageText(
          '📊 *Token Holdings*\n\nSelect a network:',
          {
            parse_mode: 'Markdown',
            ...keyboards.getNetworkSelectionKeyboard('holdings'),
          }
        );
      }
      break;
      
    case 'buy':
      await ctx.editMessageText(
        '🛒 *Buy Token*\n\nSelect a network or paste a token contract address:',
        {
          parse_mode: 'Markdown',
          ...keyboards.getNetworkSelectionKeyboard('buy'),
        }
      );
      break;
      
    case 'sell':
      await ctx.editMessageText(
        '💸 *Sell Token*\n\nSelect a network to view holdings:',
        {
          parse_mode: 'Markdown',
          ...keyboards.getNetworkSelectionKeyboard('sell'),
        }
      );
      break;
      
    case 'settings':
      if (network) {
        await showSettings(ctx, network);
      } else {
        await ctx.editMessageText(
          '⚙️ *Settings*\n\nSelect a network:',
          {
            parse_mode: 'Markdown',
            ...keyboards.getNetworkSelectionKeyboard('settings'),
          }
        );
      }
      break;
      
    case 'help':
      await ctx.editMessageText(
        '📚 *Help*\n\n' +
        'Simply paste a token contract address to get started!\n\n' +
        '*Commands:*\n' +
        '/wallet - Manage wallets\n' +
        '/holdings - View holdings\n' +
        '/buy - Buy tokens\n' +
        '/sell - Sell tokens\n' +
        '/settings - Configure settings',
        {
          parse_mode: 'Markdown',
          ...keyboards.getMainMenuKeyboard(),
        }
      );
      break;
  }
  
  await ctx.answerCbQuery();
}

/**
 * Handle wallet callbacks
 */
async function handleWalletCallback(ctx: Context, parts: string[]): Promise<void> {
  const userId = ctx.from!.id;
  const subAction = parts[1];
  const network = parts[2] as Network;
  
  switch (subAction) {
    case 'network':
      // Show wallet for selected network
      await showWalletInfo(ctx, network);
      break;
      
    case 'balance':
      await showWalletBalance(ctx, network);
      break;
      
    case 'create':
      await createWallet(ctx, network);
      break;
      
    case 'export':
      await exportPrivateKey(ctx, network);
      break;
      
    case 'import':
      setUserState(userId, { selectedNetwork: network, currentAction: 'settings' });
      await ctx.editMessageText(
        `⚠️ *Import ${network === 'solana' ? 'Solana' : 'Base'} Wallet*\n\n` +
        `Please send your private key in the next message.\n\n` +
        `🔒 Your private key will be encrypted and stored securely.\n` +
        `⚠️ The message will be deleted for security.`,
        { parse_mode: 'Markdown' }
      );
      break;
  }
  
  await ctx.answerCbQuery();
}

/**
 * Show wallet info for a network
 */
async function showWalletInfo(ctx: Context, network: Network): Promise<void> {
  const userId = ctx.from!.id;
  const wallet = db.getWallet(userId, network);
  
  if (!wallet) {
    await ctx.editMessageText(
      `💰 *${network === 'solana' ? 'Solana' : 'Base'} Wallet*\n\n` +
      `No wallet found. Would you like to create one?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔑 Create New Wallet', callback_data: `wallet:create:${network}` }],
            [{ text: '📥 Import Existing', callback_data: `wallet:import:${network}` }],
            [{ text: '« Back', callback_data: 'menu:wallet' }],
          ],
        },
      }
    );
    return;
  }
  
  await ctx.editMessageText(
    `💰 *${network === 'solana' ? 'Solana ☀️' : 'Base 🔵'} Wallet*\n\n` +
    `*Address:*\n\`${wallet.address}\`\n\n` +
    `Created: ${new Date(wallet.createdAt).toLocaleDateString()}`,
    {
      parse_mode: 'Markdown',
      ...keyboards.getWalletMenuKeyboard(network),
    }
  );
}

/**
 * Show wallet balance
 */
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
    message = `💰 *Solana Wallet Balance*\n\n` +
      `*Address:*\n\`${wallet.address}\`\n\n` +
      `*SOL Balance:* ${balance.sol.toFixed(4)} SOL\n` +
      `*USD Value:* $${balance.usd.toFixed(2)}`;
  } else {
    const balance = await base.getEthBalance(wallet.address);
    message = `💰 *Base Wallet Balance*\n\n` +
      `*Address:*\n\`${wallet.address}\`\n\n` +
      `*ETH Balance:* ${parseFloat(balance.eth).toFixed(4)} ETH\n` +
      `*USD Value:* $${balance.usd.toFixed(2)}`;
  }
  
  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboards.getWalletMenuKeyboard(network),
  });
}

/**
 * Create a new wallet
 */
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
      {
        parse_mode: 'Markdown',
        ...keyboards.getWalletMenuKeyboard(network),
      }
    );
  } else {
    await ctx.editMessageText(
      `ℹ️ *Wallet Already Exists*\n\n` +
      `*Address:*\n\`${result.address}\``,
      {
        parse_mode: 'Markdown',
        ...keyboards.getWalletMenuKeyboard(network),
      }
    );
  }
}

/**
 * Export private key
 */
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
  
  // Send private key in a separate message that auto-deletes
  const msg = await ctx.reply(
    `🔐 *Private Key*\n\n` +
    `⚠️ *NEVER share this with anyone!*\n\n` +
    `\`${privateKey}\`\n\n` +
    `_This message will be deleted in 30 seconds._`,
    { parse_mode: 'Markdown' }
  );
  
  // Delete after 30 seconds
  setTimeout(async () => {
    try {
      await ctx.deleteMessage(msg.message_id);
    } catch (e) {
      // Ignore errors
    }
  }, 30000);
  
  await ctx.answerCbQuery('Private key sent! Delete after saving.');
}

/**
 * Handle holdings callbacks
 */
async function handleHoldingsCallback(ctx: Context, parts: string[]): Promise<void> {
  const subAction = parts[1];
  const network = parts[2] as Network;
  const page = parts[3] ? parseInt(parts[3]) : 0;
  
  switch (subAction) {
    case 'network':
      await showHoldings(ctx, network);
      break;
    case 'page':
      await showHoldings(ctx, network, page);
      break;
    case 'refresh':
      await showHoldings(ctx, network);
      break;
  }
  
  await ctx.answerCbQuery();
}

/**
 * Show token holdings
 */
async function showHoldings(ctx: Context, network: Network, page: number = 0): Promise<void> {
  const userId = ctx.from!.id;
  const wallet = db.getWallet(userId, network);
  
  if (!wallet) {
    await ctx.editMessageText(
      `📊 *${network === 'solana' ? 'Solana' : 'Base'} Holdings*\n\n` +
      `No wallet found. Create one first!`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💰 Create Wallet', callback_data: `wallet:create:${network}` }],
            [{ text: '« Back', callback_data: 'menu:main' }],
          ],
        },
      }
    );
    return;
  }
  
  let holdings;
  let nativeBalance;
  
  if (network === 'solana') {
    holdings = await solana.getSolanaTokenHoldings(wallet.address);
    nativeBalance = await solana.getSolBalance(wallet.address);
  } else {
    holdings = await base.getBaseTokenHoldings(wallet.address);
    nativeBalance = await base.getEthBalance(wallet.address);
  }
  
  const nativeSymbol = network === 'solana' ? 'SOL' : 'ETH';
  const nativeAmount = network === 'solana' 
    ? (nativeBalance as any).sol.toFixed(4)
    : parseFloat((nativeBalance as any).eth).toFixed(4);
  
  let message = `📊 *${network === 'solana' ? 'Solana ☀️' : 'Base 🔵'} Holdings*\n\n`;
  message += `💎 *${nativeSymbol}:* ${nativeAmount} ($${(nativeBalance as any).usd.toFixed(2)})\n\n`;
  
  if (holdings.length === 0) {
    message += `_No token holdings found_`;
  } else {
    const totalValue = holdings.reduce((sum, h) => sum + parseFloat(h.valueUsd), 0);
    message += `*Tokens:* ${holdings.length}\n`;
    message += `*Total Value:* $${totalValue.toFixed(2)}\n\n`;
    message += `Select a token to view details or sell:`;
  }
  
  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboards.getHoldingsKeyboard(holdings, network, page),
  });
}

/**
 * Handle individual holding callbacks
 */
async function handleHoldingCallback(ctx: Context, parts: string[]): Promise<void> {
  const subAction = parts[1];
  const network = parts[2] as Network;
  const tokenAddress = parts[3];
  
  if (subAction === 'view') {
    await showHoldingDetail(ctx, network, tokenAddress);
  }
  
  await ctx.answerCbQuery();
}

/**
 * Show holding detail
 */
async function showHoldingDetail(ctx: Context, network: Network, tokenAddress: string): Promise<void> {
  const userId = ctx.from!.id;
  const wallet = db.getWallet(userId, network);
  
  if (!wallet) return;
  
  const tokenInfo = await dexscreener.getTokenInfo(tokenAddress, network);
  
  if (!tokenInfo) {
    await ctx.answerCbQuery('Token info not available');
    return;
  }
  
  // Get balance
  let balance: string;
  if (network === 'solana') {
    const holdings = await solana.getSolanaTokenHoldings(wallet.address);
    const holding = holdings.find(h => h.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
    balance = holding?.balanceFormatted || '0';
  } else {
    const { balance: bal, decimals } = await base.getTokenBalance(wallet.address, tokenAddress);
    balance = formatters.formatTokenAmount(bal.toString(), decimals);
  }
  
  const value = parseFloat(balance) * parseFloat(tokenInfo.priceUsd);
  
  const message = dexscreener.formatTokenInfoMessage(tokenInfo) +
    `\n\n*Your Balance:* ${balance} ${tokenInfo.symbol}\n` +
    `*Value:* $${value.toFixed(2)}`;
  
  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboards.getSellAmountKeyboard(network, tokenAddress, tokenInfo.symbol),
  });
}

/**
 * Handle buy callbacks
 */
async function handleBuyCallback(ctx: Context, parts: string[]): Promise<void> {
  const userId = ctx.from!.id;
  const subAction = parts[1];
  const network = parts[2] as Network;
  const tokenAddress = parts[3];
  const amountOrPercent = parts[4];
  
  switch (subAction) {
    case 'network':
      setUserState(userId, { selectedNetwork: network, currentAction: 'buying' });
      await ctx.editMessageText(
        `🛒 *Buy Token on ${network === 'solana' ? 'Solana' : 'Base'}*\n\n` +
        `Paste a token contract address to get started:`,
        { parse_mode: 'Markdown' }
      );
      break;
      
    case 'confirm':
      // Show amount selection
      await ctx.editMessageText(
        `💰 *Select Buy Amount*\n\n` +
        `How much do you want to spend?`,
        {
          parse_mode: 'Markdown',
          ...keyboards.getBuyAmountKeyboard(network, tokenAddress),
        }
      );
      break;
      
    case 'amount':
      const amount = parseFloat(amountOrPercent);
      await executeBuy(ctx, network, tokenAddress, amount);
      break;
      
    case 'percent':
      // Buy with percentage of wallet balance
      const percent = parseInt(amountOrPercent);
      const wallet = db.getWallet(userId, network);
      if (!wallet) {
        await ctx.answerCbQuery('No wallet found');
        return;
      }
      
      let balance;
      if (network === 'solana') {
        const bal = await solana.getSolBalance(wallet.address);
        balance = bal.sol * (percent / 100);
      } else {
        const bal = await base.getEthBalance(wallet.address);
        balance = parseFloat(bal.eth) * (percent / 100);
      }
      
      await executeBuy(ctx, network, tokenAddress, balance);
      break;
      
    case 'custom':
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
        `✏️ *Enter Custom Amount*\n\n` +
        `Please type the amount of ${symbol} you want to spend:`,
        { parse_mode: 'Markdown' }
      );
      break;
  }
  
  await ctx.answerCbQuery();
}

/**
 * Handle sell callbacks
 */
async function handleSellCallback(ctx: Context, parts: string[]): Promise<void> {
  const subAction = parts[1];
  const network = parts[2] as Network;
  const tokenAddress = parts[3];
  const percent = parts[4] ? parseInt(parts[4]) : 0;
  
  switch (subAction) {
    case 'network':
      await showHoldings(ctx, network);
      break;
      
    case 'select':
      await showHoldingDetail(ctx, network, tokenAddress);
      break;
      
    case 'percent':
      await executeSell(ctx, network, tokenAddress, percent);
      break;
  }
  
  await ctx.answerCbQuery();
}

/**
 * Handle settings callbacks
 */
async function handleSettingsCallback(ctx: Context, parts: string[]): Promise<void> {
  const userId = ctx.from!.id;
  const subAction = parts[1];
  const network = parts[2] as Network;
  const value = parts[3];
  const settingValue = parts[4];
  
  switch (subAction) {
    case 'network':
      await showSettings(ctx, network);
      break;
      
    case 'slippage':
      if (value === 'set' && settingValue) {
        const settings = db.getTradeSettings(userId, network);
        settings.slippageBps = parseInt(settingValue);
        db.saveTradeSettings(settings);
        await ctx.answerCbQuery(`Slippage set to ${parseInt(settingValue) / 100}%`);
        await showSettings(ctx, network);
      } else {
        await ctx.editMessageText(
          `📊 *Slippage Settings*\n\n` +
          `Select your preferred slippage tolerance:`,
          {
            parse_mode: 'Markdown',
            ...keyboards.getSlippageKeyboard(network),
          }
        );
      }
      break;
  }
  
  await ctx.answerCbQuery();
}

/**
 * Show settings for a network
 */
async function showSettings(ctx: Context, network: Network): Promise<void> {
  const userId = ctx.from!.id;
  const settings = db.getTradeSettings(userId, network);
  
  const message = `⚙️ *${network === 'solana' ? 'Solana' : 'Base'} Settings*\n\n` +
    `*Slippage:* ${settings.slippageBps / 100}%\n` +
    (network === 'solana' ? `*Priority Fee:* ${settings.priorityFeeLamports} lamports\n` : '') +
    `\nSelect a setting to modify:`;
  
  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboards.getSettingsKeyboard(network),
  });
}

/**
 * Handle token callbacks
 */
async function handleTokenCallback(ctx: Context, parts: string[]): Promise<void> {
  const subAction = parts[1];
  const network = parts[2] as Network;
  const tokenAddress = parts[3];
  
  if (subAction === 'refresh') {
    const tokenInfo = await dexscreener.getTokenInfo(tokenAddress, network);
    if (tokenInfo) {
      const message = dexscreener.formatTokenInfoMessage(tokenInfo);
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...keyboards.getQuickTradeKeyboard(network, tokenAddress),
      });
    }
  }
  
  await ctx.answerCbQuery();
}

/**
 * Handle confirmation callbacks
 */
async function handleConfirmCallback(ctx: Context, parts: string[]): Promise<void> {
  // Handle various confirmation actions
  const action = parts[1];
  // ... implement as needed
  
  await ctx.answerCbQuery();
}
