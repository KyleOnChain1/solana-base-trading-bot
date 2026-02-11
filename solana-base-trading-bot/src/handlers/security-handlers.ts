import { Context, Markup } from 'telegraf';
import * as security from '../services/security';
import * as securityDb from '../services/security-database';
import { getUserState, setUserState, clearUserState } from './commands';

// ========== /security Command ==========

export async function handleSecurity(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const antiPhishing = security.getAntiPhishingCode(userId);
  const phishingBanner = antiPhishing
    ? `🔐 Your code: *${antiPhishing}*\n\n`
    : '';

  if (security.needsPasswordSetup(userId)) {
    await ctx.reply(
      `${phishingBanner}🔐 *Security Setup Required*\n\n` +
        `To protect your wallet, you need to set a password.\n\n` +
        `⚠️ *Important:*\n` +
        `• This password encrypts your private keys\n` +
        `• If you forget it, your wallet is UNRECOVERABLE\n` +
        `• We cannot reset or recover your password\n\n` +
        `Send your desired password (min 6 characters):`,
      { parse_mode: 'Markdown' }
    );

    setUserState(userId, { currentAction: 'settings', securitySetup: { stage: 'initial', attempts: 0 } });
    return;
  }

  const sessionInfo = security.getSessionInfo(userId);
  const userSecurity = securityDb.getUserSecurity(userId);

  const statusEmoji = sessionInfo?.active ? '🟢' : '🔴';
  const statusText = sessionInfo?.active
    ? `Unlocked (${Math.floor((sessionInfo.expiresIn || 0) / 60000)}m remaining)`
    : 'Locked';

  await ctx.reply(
    `${phishingBanner}🔐 *Security Settings*\n\n` +
      `*Status:* ${statusEmoji} ${statusText}\n` +
      `*Transfer Limit:* ${userSecurity?.transferLimitSol || 1} SOL / ${userSecurity?.transferLimitEth || 0.1} ETH\n` +
      `*Anti-Phishing:* ${antiPhishing ? '✅ Set' : '❌ Not set'}\n` +
      `*2FA:* ${userSecurity?.twoFactorEnabled ? '✅ Enabled' : '❌ Disabled'}\n`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          sessionInfo?.active
            ? Markup.button.callback('🔒 Lock Wallet', 'sec:lock')
            : Markup.button.callback('🔓 Unlock Wallet', 'sec:unlock'),
        ],
        [
          Markup.button.callback('🔑 Change Password', 'sec:changepw'),
          Markup.button.callback('🛡️ Anti-Phishing', 'sec:phishing'),
        ],
        [
          Markup.button.callback('📋 Whitelist', 'sec:whitelist'),
          Markup.button.callback('⚙️ Limits', 'sec:limits'),
        ],
        [Markup.button.callback('📜 Security Log', 'sec:log')],
        [Markup.button.callback('« Back', 'm')],
      ]),
    }
  );
}

// ========== /unlock Command ==========

export async function handleUnlock(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (security.needsPasswordSetup(userId)) {
    await ctx.reply(
      '🔐 Please set up your password first with /security'
    );
    return;
  }

  if (security.isUnlocked(userId)) {
    const remaining = security.getSessionTimeRemaining(userId);
    await ctx.reply(`✅ Wallet already unlocked (${remaining}m remaining)`);
    return;
  }

  setUserState(userId, { currentAction: 'settings', pendingUnlock: true });
  await ctx.reply(
    '🔓 *Unlock Wallet*\n\nEnter your password:',
    { parse_mode: 'Markdown' }
  );
}

// ========== /lock Command ==========

export async function handleLock(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  security.lock(userId);
  await ctx.reply('🔒 Wallet locked.');
}

// ========== Security Callbacks ==========

export async function handleSecurityCallback(ctx: Context, action: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  switch (action) {
    case 'lock':
      security.lock(userId);
      await ctx.answerCbQuery('Wallet locked');
      await handleSecurity(ctx);
      break;

    case 'unlock':
      setUserState(userId, { currentAction: 'settings', pendingUnlock: true });
      await ctx.editMessageText(
        '🔓 *Unlock Wallet*\n\nEnter your password:',
        { parse_mode: 'Markdown' }
      );
      break;

    case 'changepw':
      setUserState(userId, { currentAction: 'settings', changingPassword: { stage: 'current' } });
      await ctx.editMessageText(
        '🔑 *Change Password*\n\nEnter your current password:',
        { parse_mode: 'Markdown' }
      );
      break;

    case 'phishing':
      setUserState(userId, { currentAction: 'settings', settingPhishing: true });
      await ctx.editMessageText(
        '🛡️ *Anti-Phishing Code*\n\n' +
          'Set a secret word that will appear in all bot messages.\n' +
          'If you receive a message without your code, it may be a fake!\n\n' +
          'Enter your anti-phishing code (or "clear" to remove):',
        { parse_mode: 'Markdown' }
      );
      break;

    case 'whitelist':
      await showWhitelist(ctx);
      break;

    case 'limits':
      setUserState(userId, { currentAction: 'settings', settingLimits: true });
      const sec = securityDb.getUserSecurity(userId);
      await ctx.editMessageText(
        '⚙️ *Transfer Limits*\n\n' +
          `Current: ${sec?.transferLimitSol || 1} SOL / ${sec?.transferLimitEth || 0.1} ETH\n\n` +
          'Transfers above these limits require password confirmation.\n\n' +
          'Enter new limits in format: `SOL ETH`\n' +
          'Example: `2 0.5` for 2 SOL and 0.5 ETH',
        { parse_mode: 'Markdown' }
      );
      break;

    case 'log':
      await showSecurityLog(ctx);
      break;
  }
}

// ========== Text Input Handler (for security flows) ==========

export async function handleSecurityTextInput(ctx: Context, text: string): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const state = getUserState(userId);

  // Password setup flow
  if (state.securitySetup) {
    await handlePasswordSetup(ctx, text);
    return true;
  }

  // Unlock flow
  if (state.pendingUnlock) {
    await handleUnlockInput(ctx, text);
    return true;
  }

  // Password change flow
  if (state.changingPassword) {
    await handlePasswordChange(ctx, text);
    return true;
  }

  // Anti-phishing setup
  if (state.settingPhishing) {
    await handlePhishingSetup(ctx, text);
    return true;
  }

  // Transfer limits
  if (state.settingLimits) {
    await handleLimitsSetup(ctx, text);
    return true;
  }

  return false;
}

// ========== Internal Handlers ==========

async function handlePasswordSetup(ctx: Context, password: string): Promise<void> {
  const userId = ctx.from!.id;
  const state = getUserState(userId);
  const setup = state.securitySetup!;

  // Delete password message for security
  try { await ctx.deleteMessage(); } catch {}

  if (setup.stage === 'initial') {
    if (password.length < 6) {
      await ctx.reply('❌ Password must be at least 6 characters. Try again:');
      return;
    }

    setUserState(userId, {
      currentAction: 'settings',
      securitySetup: { stage: 'confirm', tempPassword: password, attempts: 0 },
    });
    await ctx.reply('🔐 Confirm your password by typing it again:');
    return;
  }

  if (setup.stage === 'confirm') {
    if (password !== setup.tempPassword) {
      setup.attempts++;
      if (setup.attempts >= 3) {
        clearUserState(userId);
        await ctx.reply('❌ Too many failed attempts. Start over with /security');
        return;
      }
      await ctx.reply(`❌ Passwords don't match. Try again (${3 - setup.attempts} attempts left):`);
      return;
    }

    // Set up password
    const result = security.setupPassword(userId, password);
    clearUserState(userId);

    if (result.success) {
      await ctx.reply(
        '✅ *Password Set!*\n\n' +
          '🔒 Your wallet is now protected.\n\n' +
          '⚠️ *IMPORTANT:*\n' +
          '• Save your password somewhere safe\n' +
          '• We CANNOT recover it if lost\n' +
          '• Your wallet will be permanently locked without it\n\n' +
          'Use /unlock to access your wallet.',
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(`❌ Error: ${result.error}`);
    }
  }
}

async function handleUnlockInput(ctx: Context, password: string): Promise<void> {
  const userId = ctx.from!.id;

  // Delete password message
  try { await ctx.deleteMessage(); } catch {}

  // Check if there's a pending buy to resume after unlock
  const state = getUserState(userId);
  const pendingBuy = state.pendingBuyAfterUnlock;

  const result = security.unlock(userId, password);
  clearUserState(userId);

  if (result.success) {
    const remaining = security.getSessionTimeRemaining(userId);
    if (pendingBuy) {
      await ctx.reply(`🔓 Unlocked (${remaining}m session). Executing buy...`);
      const { executeBuy } = await import('./commands');
      await executeBuy(ctx, pendingBuy.network, pendingBuy.tokenAddress, pendingBuy.amount);
    } else {
      await ctx.reply(`🔓 Wallet unlocked! (${remaining}m session)`);
    }
  } else {
    if (pendingBuy) {
      // Keep the pending buy for retry
      setUserState(userId, { pendingUnlock: true, pendingBuyAfterUnlock: pendingBuy });
    }
    await ctx.reply(`❌ ${result.error}`);
  }
}

async function handlePasswordChange(ctx: Context, password: string): Promise<void> {
  const userId = ctx.from!.id;
  const state = getUserState(userId);
  const change = state.changingPassword!;

  // Delete password message
  try { await ctx.deleteMessage(); } catch {}

  if (change.stage === 'current') {
    setUserState(userId, {
      currentAction: 'settings',
      changingPassword: { stage: 'new', currentPassword: password },
    });
    await ctx.reply('🔑 Enter your new password:');
    return;
  }

  if (change.stage === 'new') {
    if (password.length < 6) {
      await ctx.reply('❌ Password must be at least 6 characters. Try again:');
      return;
    }
    setUserState(userId, {
      currentAction: 'settings',
      changingPassword: { ...change, stage: 'confirm', newPassword: password },
    });
    await ctx.reply('🔑 Confirm your new password:');
    return;
  }

  if (change.stage === 'confirm') {
    if (password !== change.newPassword) {
      clearUserState(userId);
      await ctx.reply("❌ Passwords don't match. Start over with /security");
      return;
    }

    const result = security.changePassword(userId, change.currentPassword!, password);
    clearUserState(userId);

    if (result.success) {
      await ctx.reply('✅ Password changed! Please unlock with your new password.');
    } else {
      await ctx.reply(`❌ ${result.error}`);
    }
  }
}

async function handlePhishingSetup(ctx: Context, code: string): Promise<void> {
  const userId = ctx.from!.id;
  clearUserState(userId);

  if (code.toLowerCase() === 'clear') {
    security.setAntiPhishingCode(userId, '');
    await ctx.reply('✅ Anti-phishing code removed.');
  } else if (code.length > 20) {
    await ctx.reply('❌ Code too long (max 20 characters)');
  } else {
    security.setAntiPhishingCode(userId, code);
    await ctx.reply(`✅ Anti-phishing code set to: *${code}*\n\nThis will appear in all bot messages.`, {
      parse_mode: 'Markdown',
    });
  }
}

async function handleLimitsSetup(ctx: Context, input: string): Promise<void> {
  const userId = ctx.from!.id;
  clearUserState(userId);

  const parts = input.split(/\s+/);
  if (parts.length !== 2) {
    await ctx.reply('❌ Invalid format. Use: `SOL ETH` (e.g., `2 0.5`)', { parse_mode: 'Markdown' });
    return;
  }

  const sol = parseFloat(parts[0]);
  const eth = parseFloat(parts[1]);

  if (isNaN(sol) || isNaN(eth) || sol < 0 || eth < 0) {
    await ctx.reply('❌ Invalid numbers. Use positive values.');
    return;
  }

  security.setTransferLimits(userId, sol, eth);
  await ctx.reply(`✅ Transfer limits set: ${sol} SOL / ${eth} ETH`);
}

async function showWhitelist(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const whitelist = security.getWhitelist(userId);

  if (whitelist.length === 0) {
    await ctx.editMessageText(
      '📋 *Withdrawal Whitelist*\n\n' +
        'No addresses whitelisted yet.\n\n' +
        'Whitelisted addresses skip password confirmation for withdrawals.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Add Address', 'sec:wl_add')],
          [Markup.button.callback('« Back', 'sec:main')],
        ]),
      }
    );
    return;
  }

  let message = '📋 *Withdrawal Whitelist*\n\n';
  for (const addr of whitelist) {
    const network = addr.network === 'solana' ? '☀️' : '🔵';
    const label = addr.label ? ` (${addr.label})` : '';
    message += `${network} \`${addr.address.slice(0, 8)}...${addr.address.slice(-6)}\`${label}\n`;
  }

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('➕ Add Address', 'sec:wl_add')],
      [Markup.button.callback('➖ Remove Address', 'sec:wl_remove')],
      [Markup.button.callback('« Back', 'sec:main')],
    ]),
  });
}

async function showSecurityLog(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;
  const log = securityDb.getSecurityLog(userId, 10);

  let message = '📜 *Security Log*\n\n';

  if (log.length === 0) {
    message += '_No events yet_';
  } else {
    for (const event of log) {
      const date = new Date(event.created_at).toLocaleString();
      message += `• ${event.action} - ${date}\n`;
    }
  }

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('« Back', 'sec:main')]]),
  });
}
