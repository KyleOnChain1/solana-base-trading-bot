import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { config, validateConfig } from './config';
import { initDatabase, closeDatabase } from './services/database';
import {
  handleStart,
  handleHelp,
  handleWallet,
  handleHoldings,
  handleBuy,
  handleSell,
  handleSettings,
  handleHistory,
  handleTextMessage,
} from './handlers/commands';
import { handleCallback } from './handlers/callbacks';
import { handleSecurity, handleUnlock, handleLock } from './handlers/security-handlers';
import { handleLimit, handleOrders } from './handlers/limit-order-handlers';
import { startSessionCleanup, stopSessionCleanup } from './services/session-manager';
import { initTriggerOrderService, startMonitoring, stopMonitoring } from './services/trigger-orders';

// Validate configuration
try {
  validateConfig();
} catch (error) {
  console.error('Configuration error:', error);
  process.exit(1);
}

// Initialize database
console.log('Initializing database...');
initDatabase();

// Start session cleanup
startSessionCleanup();

// Create bot instance
const bot = new Telegraf(config.telegramBotToken);

// Initialize trigger order service
initTriggerOrderService(bot);

// Error handling
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('An error occurred. Please try again.').catch(() => {});
});

// Command handlers
bot.command('start', handleStart);
bot.command('help', handleHelp);
bot.command('wallet', handleWallet);
bot.command('holdings', handleHoldings);
bot.command('buy', handleBuy);
bot.command('sell', handleSell);
bot.command('settings', handleSettings);
bot.command('history', handleHistory);

// Security commands
bot.command('security', handleSecurity);
bot.command('unlock', handleUnlock);
bot.command('lock', handleLock);

// Limit order commands
bot.command('limit', handleLimit);
bot.command('orders', handleOrders);

// Callback query handler (inline button presses)
bot.on('callback_query', handleCallback);

// Text message handler (for token addresses and custom inputs)
bot.on(message('text'), handleTextMessage);

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  
  bot.stop(signal);
  stopSessionCleanup();
  stopMonitoring();
  closeDatabase();
  
  process.exit(0);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// Start bot
console.log('Starting bot...');
bot.launch()
  .then(() => {
    console.log('✅ Bot is running!');
    console.log('Starting limit order monitoring...');
    startMonitoring();
    console.log('Press Ctrl+C to stop.');
  })
  .catch((error) => {
    console.error('Failed to start bot:', error);
    process.exit(1);
  });
