import * as security from './security';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  AccountLayout,
} from '@solana/spl-token';
import axios from 'axios';
import bs58 from 'bs58';
import { config } from '../config';

import { getWallet, saveWallet } from './database';
import { getTokenInfo, getMultipleTokensInfo } from './dexscreener';
import { 
  TokenHolding, 
  SwapQuote, 
  TransactionResult,
  JupiterQuoteResponse,
  JupiterSwapResponse,
} from '../types';

const connection = new Connection(config.solanaRpcUrl, 'confirmed');

const jupiterApi = axios.create({
  baseURL: config.jupiterApiUrl,
  timeout: 30000,
});

// ============ Wallet Management ============

/**
*/
export async function createSolanaWallet(
  telegramUserId: number,
  password?: string
): Promise<{
  address: string;
  created: boolean;
  needsPassword?: boolean;
  error?: string;
}> {
  // Check if wallet already exists
  const existing = getWallet(telegramUserId, 'solana');
  if (existing) {
    return { address: existing.address, created: false };
  }
  
  // Must have security set up
  if (security.needsPasswordSetup(telegramUserId)) {
    return { address: '', created: false, error: 'Please set up security first with /security' };
  }
  
  // If no password provided, indicate we need one
  if (!password) {
    return { address: '', created: false, needsPassword: true };
  }
  
  // Generate new keypair
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  const privateKey = bs58.encode(keypair.secretKey);
  
  // Encrypt and save using security service
  const result = security.createEncryptedWallet(telegramUserId, 'solana', address, privateKey, password);
  if (!result.success) {
    return { address: '', created: false, error: result.error };
  }
  
  return { address, created: true };
}
/**

 * Import an existing Solana wallet
 */
export async function importSolanaWallet(
  telegramUserId: number, 
  privateKey: string,
  password?: string
): Promise<{ address: string; success: boolean; needsPassword?: boolean; error?: string }> {
  // Must have security set up
  if (security.needsPasswordSetup(telegramUserId)) {
    return { address: '', success: false, error: 'Please set up security first with /security' };
  }
  
  // If no password provided, indicate we need one
  if (!password) {
    return { address: '', success: false, needsPassword: true };
  }

  try {
    // Validate and decode private key
    let secretKey: Uint8Array;
    
    if (privateKey.startsWith('[')) {
      // JSON array format
      secretKey = new Uint8Array(JSON.parse(privateKey));
    } else {
      // Base58 format
      secretKey = bs58.decode(privateKey);
    }
    
    if (secretKey.length !== 64) {
      return { address: '', success: false, error: 'Invalid private key length' };
    }
    
    const keypair = Keypair.fromSecretKey(secretKey);
    const address = keypair.publicKey.toBase58();
    
    // Encrypt and save using security service
    const result = security.createEncryptedWallet(
      telegramUserId, 
      'solana', 
      address, 
      bs58.encode(secretKey), 
      password
    );
    if (!result.success) {
      return { address: '', success: false, error: result.error };
    }
    
    return { address, success: true };
    
  } catch (error) {
    console.error('Error importing Solana wallet:', error);
    return { address: '', success: false, error: 'Invalid private key format' };
  }
}
/**
 * Get Solana wallet keypair for a user
 */
export function getSolanaKeypair(telegramUserId: number): Keypair | null {
  // Must be unlocked to use wallet
  const privateKey = security.getPrivateKey(telegramUserId, 'solana');
  if (!privateKey) return null;
  
  try {
    const secretKey = bs58.decode(privateKey);
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    console.error('Error creating Solana keypair:', error);
    return null;
  }
}

/**
 * Export private key (for user backup)
 */
export function exportSolanaPrivateKey(telegramUserId: number): string | null {
  // Must be unlocked - returns key from session
  return security.getPrivateKey(telegramUserId, 'solana');
}

// ============ Balance & Holdings ============

/**
 * Get SOL balance for a wallet
 */
export async function getSolBalance(address: string): Promise<{
  lamports: number;
  sol: number;
  usd: number;
}> {
  try {
    const publicKey = new PublicKey(address);
    const lamports = await connection.getBalance(publicKey);
    const sol = lamports / LAMPORTS_PER_SOL;
    
    // Get SOL price
    const solInfo = await getTokenInfo(config.solana.nativeMint, 'solana');
    const solPrice = solInfo ? parseFloat(solInfo.priceUsd) : 0;
    
    return {
      lamports,
      sol,
      usd: sol * solPrice,
    };
  } catch (error) {
    console.error('Error getting SOL balance:', error);
    return { lamports: 0, sol: 0, usd: 0 };
  }
}

/**
 * Get all token holdings for a wallet
 */
export async function getSolanaTokenHoldings(address: string): Promise<TokenHolding[]> {
  try {
    const publicKey = new PublicKey(address);
    const holdings: TokenHolding[] = [];
    const tokenAddresses: string[] = [];

    // Use a single raw RPC call to get ALL token accounts (both SPL and Token-2022)
    // by fetching parsed accounts owned by wallet with both programs in one batch
    const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

    // Fetch both programs in parallel with a single Promise.all
    const [splAccounts, token2022Accounts] = await Promise.all([
      connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }).catch(() => ({ value: [] })),
      connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID }).catch(() => ({ value: [] })),
    ]);

    const allAccounts = [...splAccounts.value, ...token2022Accounts.value];

    for (const { account } of allAccounts) {
      const parsed = (account.data as any).parsed?.info;
      if (!parsed) continue;

      const mint: string = parsed.mint;
      const tokenAmount = parsed.tokenAmount;
      const rawBalance: string = tokenAmount.amount;
      const decimals: number = tokenAmount.decimals;
      const uiAmount: number = tokenAmount.uiAmount || 0;

      if (BigInt(rawBalance) <= 0n) continue;

      tokenAddresses.push(mint);

      holdings.push({
        tokenAddress: mint,
        symbol: '',
        name: '',
        balance: rawBalance,
        balanceFormatted: uiAmount.toFixed(4),
        decimals,
        priceUsd: '0',
        valueUsd: '0',
        network: 'solana',
      });
    }

    // Fetch token info from DexScreener
    if (tokenAddresses.length > 0) {
      const tokenInfoMap = await getMultipleTokensInfo(tokenAddresses, 'solana');

      for (const holding of holdings) {
        const info = tokenInfoMap.get(holding.tokenAddress.toLowerCase());
        if (info) {
          holding.symbol = info.symbol;
          holding.name = info.name;
          holding.priceUsd = info.priceUsd;

          const balance = parseFloat(holding.balance) / Math.pow(10, holding.decimals);
          holding.balanceFormatted = balance.toFixed(4);
          holding.valueUsd = (balance * parseFloat(info.priceUsd)).toFixed(2);
        } else {
          holding.symbol = holding.tokenAddress.slice(0, 4) + '..';
          holding.name = 'Unknown Token';
        }
      }
    }

    holdings.sort((a, b) => parseFloat(b.valueUsd) - parseFloat(a.valueUsd));

    return holdings;

  } catch (error) {
    console.error('Error getting Solana token holdings:', error);
    return [];
  }
}


// ============ Jupiter Trading ============

/**
 * Get a swap quote from Jupiter
 */
export async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number = 100
): Promise<SwapQuote | null> {
  try {
    const response = await jupiterApi.get<JupiterQuoteResponse>('/quote', {
      params: {
        inputMint,
        outputMint,
        amount,
        slippageBps,
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
      },
    });
    
    const quote = response.data;
    
    // Get route labels
    const routeLabels = quote.routePlan
      .map(r => r.swapInfo.label)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(' → ');
    
    return {
      inputToken: quote.inputMint,
      outputToken: quote.outputMint,
      inputAmount: quote.inAmount,
      outputAmount: quote.outAmount,
      outputAmountFormatted: (parseFloat(quote.outAmount) / 1e9).toFixed(6),
      priceImpact: quote.priceImpactPct,
      route: routeLabels || 'Direct',
    };
    
  } catch (error: any) {
    console.error('Error getting Jupiter quote:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Execute a swap using Jupiter
 */
export async function executeJupiterSwap(
  telegramUserId: number,
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number = 100,
  priorityFeeLamports?: number
): Promise<TransactionResult> {
  try {
    const keypair = getSolanaKeypair(telegramUserId);
    if (!keypair) {
      return { success: false, error: 'Wallet not found' };
    }
    
    const userPublicKey = keypair.publicKey.toBase58();
    
    // Get quote first
    const quoteResponse = await jupiterApi.get<JupiterQuoteResponse>('/quote', {
      params: {
        inputMint,
        outputMint,
        amount,
        slippageBps,
      },
    });
    
    // Get swap transaction
    const swapResponse = await jupiterApi.post<JupiterSwapResponse>('/swap', {
      quoteResponse: quoteResponse.data,
      userPublicKey,
      wrapAndUnwrapSol: true,
      computeUnitPriceMicroLamports: priorityFeeLamports 
        ? Math.floor(priorityFeeLamports / 1.4) // Convert to compute unit price
        : 'auto',
      dynamicComputeUnitLimit: true,
    });
    
    // Deserialize and sign transaction
    const swapTransactionBuf = Buffer.from(swapResponse.data.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([keypair]);
    
    // Send transaction
    const rawTransaction = transaction.serialize();
    const signature = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: transaction.message.recentBlockhash,
      lastValidBlockHeight: swapResponse.data.lastValidBlockHeight,
    }, 'confirmed');
    
    if (confirmation.value.err) {
      return { 
        success: false, 
        signature,
        error: 'Transaction failed on-chain',
        explorerUrl: `${config.explorers.solana}${signature}`,
      };
    }
    
    return {
      success: true,
      signature,
      explorerUrl: `${config.explorers.solana}${signature}`,
    };
    
  } catch (error: any) {
    console.error('Error executing Jupiter swap:', error.response?.data || error.message);
    return { 
      success: false, 
      error: error.response?.data?.error || error.message || 'Swap failed',
    };
  }
}

/**
 * Buy a token with SOL
 */
export async function buySolanaToken(
  telegramUserId: number,
  tokenAddress: string,
  solAmount: number,
  slippageBps: number = 100
): Promise<TransactionResult> {
  const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL).toString();
  
  return executeJupiterSwap(
    telegramUserId,
    config.solana.nativeMint,
    tokenAddress,
    lamports,
    slippageBps
  );
}

/**
 * Sell a token for SOL
 */
export async function sellSolanaToken(
  telegramUserId: number,
  tokenAddress: string,
  tokenAmount: string,
  slippageBps: number = 100
): Promise<TransactionResult> {
  return executeJupiterSwap(
    telegramUserId,
    tokenAddress,
    config.solana.nativeMint,
    tokenAmount,
    slippageBps
  );
}

/**
 * Sell a percentage of token holdings
 */
export async function sellSolanaTokenPercentage(
  telegramUserId: number,
  tokenAddress: string,
  percentage: number,
  slippageBps: number = 100
): Promise<TransactionResult> {
  try {
    const keypair = getSolanaKeypair(telegramUserId);
    if (!keypair) {
      return { success: false, error: 'Wallet not found' };
    }

    const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    const mintAddress = tokenAddress.toLowerCase();

    console.log('Sell: looking for mint', mintAddress);

    // Fetch both programs in parallel to avoid sequential rate limits
    const [splAccounts, token2022Accounts] = await Promise.all([
      connection.getParsedTokenAccountsByOwner(keypair.publicKey, { programId: TOKEN_PROGRAM_ID })
        .catch((e) => { console.log('SPL fetch failed:', e.message); return { value: [] as any[] }; }),
      connection.getParsedTokenAccountsByOwner(keypair.publicKey, { programId: TOKEN_2022_PROGRAM_ID })
        .catch((e) => { console.log('Token2022 fetch failed:', e.message); return { value: [] as any[] }; }),
    ]);

    const allAccounts = [...splAccounts.value, ...token2022Accounts.value];
    console.log('Sell: found', allAccounts.length, 'token accounts total');

    let foundBalance: bigint | null = null;

    for (const { account } of allAccounts) {
      const parsed = (account.data as any).parsed?.info;
      if (!parsed) continue;

      if (parsed.mint.toLowerCase() === mintAddress) {
        const rawBalance = BigInt(parsed.tokenAmount.amount);
        console.log('Sell: matched mint, balance =', rawBalance.toString());
        if (rawBalance > 0n) {
          foundBalance = rawBalance;
          break;
        }
      }
    }

    if (foundBalance === null || foundBalance === 0n) {
      console.log('Sell: no balance found for', mintAddress);
      return { success: false, error: 'No token balance found' };
    }

    const sellAmount = (foundBalance * BigInt(percentage)) / 100n;
    console.log('Sell: selling', sellAmount.toString(), '(' + percentage + '%)');

    if (sellAmount === 0n) {
      return { success: false, error: 'Insufficient balance' };
    }

    return sellSolanaToken(
      telegramUserId,
      tokenAddress,
      sellAmount.toString(),
      slippageBps
    );

  } catch (error: any) {
    console.error('Error selling token percentage:', error);
    return { success: false, error: error.message || 'Failed to sell token' };
  }
}

// ============== Withdraw ==============

/**
 * Withdraw native SOL to an external address
 * Reserves 0.01 SOL for gas fees
 */
export async function withdrawSol(
  telegramUserId: number,
  toAddress: string,
  amount: string // "all" or SOL amount
): Promise<TransactionResult> {
  const keypair = getSolanaKeypair(telegramUserId);
  if (!keypair) throw new Error('No Solana wallet found');

  const balance = await getSolBalance(keypair.publicKey.toBase58());
  const GAS_RESERVE = 0.01; // Reserve 0.01 SOL for future gas

  let solToSend: number;
  if (amount === 'all') {
    solToSend = balance.sol - GAS_RESERVE;
  } else {
    solToSend = parseFloat(amount);
    if (balance.sol - solToSend < GAS_RESERVE) {
      solToSend = balance.sol - GAS_RESERVE;
    }
  }

  if (solToSend <= 0) throw new Error(`Insufficient balance. Need to keep ${GAS_RESERVE} SOL for gas.`);

  const lamports = Math.floor(solToSend * LAMPORTS_PER_SOL);
  const recipient = new PublicKey(toAddress);

  const transaction = new (await import('@solana/web3.js')).Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipient,
      lamports,
    })
  );

  transaction.feePayer = keypair.publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  transaction.sign(keypair);

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  await connection.confirmTransaction(signature, 'confirmed');

  return {
    success: true,
    signature,
    message: `Withdrew ${solToSend.toFixed(4)} SOL`,
  };
}

/**
 * Withdraw SPL token to an external address
 */
export async function withdrawSplToken(
  telegramUserId: number,
  tokenMint: string,
  toAddress: string,
  amount: string, // "all" or token amount
  decimals: number
): Promise<TransactionResult> {
  const keypair = getSolanaKeypair(telegramUserId);
  if (!keypair) throw new Error('No Solana wallet found');

  const { createTransferInstruction, getOrCreateAssociatedTokenAccount } = await import('@solana/spl-token');

  const mintPubkey = new PublicKey(tokenMint);
  const recipientPubkey = new PublicKey(toAddress);

  // Get source token account
  const sourceAta = await getAssociatedTokenAddress(mintPubkey, keypair.publicKey);
  const sourceAccountInfo = await connection.getTokenAccountBalance(sourceAta);
  const tokenBalance = parseFloat(sourceAccountInfo.value.uiAmountString || '0');

  let tokensToSend: number;
  if (amount === 'all') {
    tokensToSend = tokenBalance;
  } else {
    tokensToSend = parseFloat(amount);
  }

  if (tokensToSend <= 0 || tokensToSend > tokenBalance) throw new Error('Insufficient token balance');

  const rawAmount = BigInt(Math.floor(tokensToSend * Math.pow(10, decimals)));

  // Get or create recipient token account
  const destAta = await getOrCreateAssociatedTokenAccount(
    connection, keypair, mintPubkey, recipientPubkey
  );

  const transaction = new (await import('@solana/web3.js')).Transaction().add(
    createTransferInstruction(sourceAta, destAta.address, keypair.publicKey, rawAmount)
  );

  transaction.feePayer = keypair.publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  transaction.sign(keypair);

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  await connection.confirmTransaction(signature, 'confirmed');

  return {
    success: true,
    signature,
    message: `Withdrew ${tokensToSend} tokens`,
  };
}
