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

// Create bot instance
const bot = new Telegraf(config.telegramBotToken);

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

// Callback query handler (inline button presses)
bot.on('callback_query', handleCallback);

// Text message handler (for token addresses and custom inputs)
bot.on(message('text'), handleTextMessage);

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  
  bot.stop(signal);
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
    console.log('Press Ctrl+C to stop.');
  })
  .catch((error) => {
    console.error('Failed to start bot:', error);
    process.exit(1);
  });
