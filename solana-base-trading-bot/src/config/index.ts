import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  // Telegram
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  
  // Encryption
  walletEncryptionKey: process.env.WALLET_ENCRYPTION_KEY || '',
  
  // Solana
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  
  // Base
  baseRpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  
  // 1inch (optional)
  oneInchApiKey: process.env.ONEINCH_API_KEY || '',
  
  // Default trading settings
  defaultSlippageBps: parseInt(process.env.DEFAULT_SLIPPAGE_BPS || '100', 10),
  defaultPriorityFeeLamports: parseInt(process.env.DEFAULT_PRIORITY_FEE_LAMPORTS || '100000', 10),
  
  // Database
  databasePath: process.env.DATABASE_PATH || './data/bot.db',
  
  // API endpoints
  jupiterApiUrl: 'https://quote-api.jup.ag/v6',
  dexScreenerApiUrl: 'https://api.dexscreener.com',
  llamaSwapApiUrl: 'https://swap.defillama.com',
  oneInchApiUrl: 'https://api.1inch.dev/swap/v6.1/8453', // Base chain ID
  
  // Native token addresses
  solana: {
    nativeMint: 'So11111111111111111111111111111111111111112',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
  base: {
    nativeToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
    wethAddress: '0x4200000000000000000000000000000000000006',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  
  // Chain IDs
  baseChainId: 8453,
  
  // Explorers
  explorers: {
    solana: 'https://solscan.io/tx/',
    base: 'https://basescan.org/tx/',
  },
};

// Validate required config
export function validateConfig(): void {
  const required = [
    'telegramBotToken',
    'walletEncryptionKey',
  ];
  
  const missing = required.filter(key => !config[key as keyof typeof config]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
  
  // Validate encryption key length (should be 32 bytes = 64 hex chars)
  if (config.walletEncryptionKey.length !== 64) {
    throw new Error('WALLET_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
}
