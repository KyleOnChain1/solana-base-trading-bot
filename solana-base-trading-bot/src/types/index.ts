// Network types
export type Network = 'solana' | 'base';

// Token information from DexScreener
export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  priceUsd: string;
  priceNative: string;
  fdv?: number;
  marketCap?: number;
  volume24h?: number;
  priceChange24h?: number;
  liquidity?: number;
  logoUrl?: string;
  network: Network;
}

// Wallet types
export interface WalletInfo {
  address: string;
  network: Network;
}

export interface UserWallet {
  id: number;
  telegramUserId: number;
  network: Network;
  address: string;
  encryptedPrivateKey: string;
  createdAt: string;
}

// Token holding with real-time value
export interface TokenHolding {
  tokenAddress: string;
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  decimals: number;
  priceUsd: string;
  valueUsd: string;
  network: Network;
}

// Trade types
export interface TradeSettings {
  userId: number;
  network: Network;
  defaultBuyAmountSol?: string;
  defaultBuyAmountEth?: string;
  defaultBuyPercentage?: number;
  slippageBps: number;
  priorityFeeLamports?: number;
}

export interface PendingTrade {
  userId: number;
  chatId: number;
  tokenAddress: string;
  tokenInfo: TokenInfo;
  network: Network;
  action: 'buy' | 'sell';
  stage: 'confirm_token' | 'select_amount' | 'confirm_trade';
}

// Quote types
export interface SwapQuote {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  outputAmount: string;
  outputAmountFormatted: string;
  priceImpact: string;
  route: string;
  estimatedGas?: string;
}

// Transaction result
export interface TransactionResult {
  success: boolean;
  signature?: string;
  message?: string;
  hash?: string;
  error?: string;
  explorerUrl?: string;
}

// DexScreener API response types
export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
  info?: {
    imageUrl?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

export interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
}

// Jupiter API types
export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee?: {
    amount: string;
    feeBps: number;
  };
  priceImpactPct: string;
  routePlan: {
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }[];
}

export interface JupiterSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports?: number;
}

// Pending withdraw state
export interface PendingWithdraw {
  network: Network;
  tokenAddress?: string; // undefined = native (SOL/ETH)
  tokenSymbol?: string;
  tokenDecimals?: number;
  toAddress?: string;
  amount?: string; // "all" or a number
  stage: 'select_token' | 'enter_address' | 'enter_amount' | 'confirm';
}

// User state for conversation flow
export interface UserState {
  // Security flows
  securitySetup?: { stage: string; tempPassword?: string; attempts: number };
  pendingUnlock?: boolean;
  changingPassword?: { stage: string; currentPassword?: string; newPassword?: string };
  settingPhishing?: boolean;
  settingLimits?: boolean;
  currentAction?: 'buying' | 'selling' | 'settings' | 'withdrawing' | 'limit_order';
  pendingTrade?: PendingTrade;
  selectedNetwork?: Network;
  pendingWithdraw?: PendingWithdraw;
  pendingTriggerOrder?: import('./trigger-orders').PendingTriggerOrder;
  // Auto-unlock: pending buy that triggered a password prompt
  pendingBuyAfterUnlock?: { network: Network; tokenAddress: string; amount: number };
}

// Callback data structure
export interface CallbackData {
  action: string;
  network?: Network;
  tokenAddress?: string;
  amount?: string;
  percentage?: number;
  page?: number;
}
