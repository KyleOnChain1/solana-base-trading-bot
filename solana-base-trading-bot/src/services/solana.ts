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
import { encrypt, decrypt } from '../utils/encryption';
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
 * Create a new Solana wallet for a user
 */
export async function createSolanaWallet(telegramUserId: number): Promise<{
  address: string;
  created: boolean;
}> {
  // Check if wallet already exists
  const existing = getWallet(telegramUserId, 'solana');
  if (existing) {
    return { address: existing.address, created: false };
  }
  
  // Generate new keypair
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  const privateKey = bs58.encode(keypair.secretKey);
  
  // Encrypt and save
  const encryptedKey = encrypt(privateKey);
  saveWallet(telegramUserId, 'solana', address, encryptedKey);
  
  return { address, created: true };
}

/**
 * Import an existing Solana wallet
 */
export async function importSolanaWallet(
  telegramUserId: number, 
  privateKey: string
): Promise<{ address: string; success: boolean; error?: string }> {
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
    
    // Encrypt and save
    const encryptedKey = encrypt(bs58.encode(secretKey));
    saveWallet(telegramUserId, 'solana', address, encryptedKey);
    
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
  const wallet = getWallet(telegramUserId, 'solana');
  if (!wallet) return null;
  
  try {
    const privateKey = decrypt(wallet.encryptedPrivateKey);
    const secretKey = bs58.decode(privateKey);
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    console.error('Error decrypting Solana wallet:', error);
    return null;
  }
}

/**
 * Export private key (for user backup)
 */
export function exportSolanaPrivateKey(telegramUserId: number): string | null {
  const wallet = getWallet(telegramUserId, 'solana');
  if (!wallet) return null;
  
  try {
    return decrypt(wallet.encryptedPrivateKey);
  } catch (error) {
    console.error('Error exporting Solana private key:', error);
    return null;
  }
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
    
    // Get all token accounts
    const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
      programId: TOKEN_PROGRAM_ID,
    });
    
    const holdings: TokenHolding[] = [];
    const tokenAddresses: string[] = [];
    
    // Parse token account data
    for (const { account } of tokenAccounts.value) {
      const data = AccountLayout.decode(account.data);
      const balance = data.amount.toString();
      
      if (BigInt(balance) > 0n) {
        const mint = new PublicKey(data.mint).toBase58();
        tokenAddresses.push(mint);
        
        holdings.push({
          tokenAddress: mint,
          symbol: '',
          name: '',
          balance,
          balanceFormatted: '',
          decimals: 0,
          priceUsd: '0',
          valueUsd: '0',
          network: 'solana',
        });
      }
    }
    
    // Fetch token info from DexScreener
    const tokenInfoMap = await getMultipleTokensInfo(tokenAddresses, 'solana');
    
    // Merge token info with holdings
    for (const holding of holdings) {
      const info = tokenInfoMap.get(holding.tokenAddress.toLowerCase());
      if (info) {
        holding.symbol = info.symbol;
        holding.name = info.name;
        holding.decimals = info.decimals || 9;
        holding.priceUsd = info.priceUsd;
        
        const balance = parseFloat(holding.balance) / Math.pow(10, holding.decimals);
        holding.balanceFormatted = balance.toFixed(4);
        holding.valueUsd = (balance * parseFloat(info.priceUsd)).toFixed(2);
      } else {
        // Unknown token - try to get decimals from account
        holding.decimals = 9;
        holding.balanceFormatted = (parseFloat(holding.balance) / Math.pow(10, 9)).toFixed(4);
      }
    }
    
    // Sort by USD value descending
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
    
    // Get token balance
    const tokenMint = new PublicKey(tokenAddress);
    const ata = await getAssociatedTokenAddress(tokenMint, keypair.publicKey);
    
    try {
      const account = await getAccount(connection, ata);
      const balance = account.amount;
      const sellAmount = (balance * BigInt(percentage)) / 100n;
      
      if (sellAmount === 0n) {
        return { success: false, error: 'Insufficient balance' };
      }
      
      return sellSolanaToken(
        telegramUserId,
        tokenAddress,
        sellAmount.toString(),
        slippageBps
      );
      
    } catch {
      return { success: false, error: 'No token balance found' };
    }
    
  } catch (error: any) {
    console.error('Error selling token percentage:', error);
    return { success: false, error: error.message || 'Failed to sell token' };
  }
}
