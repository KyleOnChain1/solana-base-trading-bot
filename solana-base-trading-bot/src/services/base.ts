import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  formatUnits,
  parseUnits,
  Address,
  Hex,
  encodeFunctionData,
  erc20Abi,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { encrypt, decrypt } from '../utils/encryption';
import { getWallet, saveWallet } from './database';
import { getTokenInfo, getMultipleTokensInfo } from './dexscreener';
import { TokenHolding, SwapQuote, TransactionResult } from '../types';

// Create clients
const publicClient = createPublicClient({
  chain: base,
  transport: http(config.baseRpcUrl),
});

// 1inch or LlamaSwap API
const swapApi = axios.create({
  timeout: 30000,
});

// ERC20 ABI for common functions
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// 1inch Aggregation Router V6
const AGGREGATION_ROUTER_V6 = '0x111111125421ca6dc452d289314280a0f8842a65';

// ============ Wallet Management ============

/**
 * Create a new Base wallet for a user
 */
export async function createBaseWallet(telegramUserId: number): Promise<{
  address: string;
  created: boolean;
}> {
  // Check if wallet already exists
  const existing = getWallet(telegramUserId, 'base');
  if (existing) {
    return { address: existing.address, created: false };
  }
  
  // Generate new private key
  const privateKey = ('0x' + crypto.randomBytes(32).toString('hex')) as Hex;
  const account = privateKeyToAccount(privateKey);
  
  // Encrypt and save
  const encryptedKey = encrypt(privateKey);
  saveWallet(telegramUserId, 'base', account.address, encryptedKey);
  
  return { address: account.address, created: true };
}

/**
 * Import an existing Base wallet
 */
export async function importBaseWallet(
  telegramUserId: number,
  privateKey: string
): Promise<{ address: string; success: boolean; error?: string }> {
  try {
    // Ensure 0x prefix
    const key = (privateKey.startsWith('0x') ? privateKey : '0x' + privateKey) as Hex;
    
    // Validate by creating account
    const account = privateKeyToAccount(key);
    
    // Encrypt and save
    const encryptedKey = encrypt(key);
    saveWallet(telegramUserId, 'base', account.address, encryptedKey);
    
    return { address: account.address, success: true };
    
  } catch (error) {
    console.error('Error importing Base wallet:', error);
    return { address: '', success: false, error: 'Invalid private key format' };
  }
}

/**
 * Get Base wallet account for a user
 */
export function getBaseAccount(telegramUserId: number) {
  const wallet = getWallet(telegramUserId, 'base');
  if (!wallet) return null;
  
  try {
    const privateKey = decrypt(wallet.encryptedPrivateKey) as Hex;
    return privateKeyToAccount(privateKey);
  } catch (error) {
    console.error('Error decrypting Base wallet:', error);
    return null;
  }
}

/**
 * Export private key (for user backup)
 */
export function exportBasePrivateKey(telegramUserId: number): string | null {
  const wallet = getWallet(telegramUserId, 'base');
  if (!wallet) return null;
  
  try {
    return decrypt(wallet.encryptedPrivateKey);
  } catch (error) {
    console.error('Error exporting Base private key:', error);
    return null;
  }
}

// ============ Balance & Holdings ============

/**
 * Get ETH balance for a wallet
 */
export async function getEthBalance(address: string): Promise<{
  wei: bigint;
  eth: string;
  usd: number;
}> {
  try {
    const wei = await publicClient.getBalance({ address: address as Address });
    const eth = formatEther(wei);
    
    // Get ETH price
    const ethInfo = await getTokenInfo(config.base.wethAddress, 'base');
    const ethPrice = ethInfo ? parseFloat(ethInfo.priceUsd) : 0;
    
    return {
      wei,
      eth,
      usd: parseFloat(eth) * ethPrice,
    };
  } catch (error) {
    console.error('Error getting ETH balance:', error);
    return { wei: 0n, eth: '0', usd: 0 };
  }
}

/**
 * Get ERC20 token balance
 */
export async function getTokenBalance(
  walletAddress: string,
  tokenAddress: string
): Promise<{ balance: bigint; decimals: number }> {
  try {
    const [balance, decimals] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [walletAddress as Address],
      }),
      publicClient.readContract({
        address: tokenAddress as Address,
        abi: ERC20_ABI,
        functionName: 'decimals',
      }),
    ]);
    
    return { balance: balance as bigint, decimals: decimals as number };
  } catch (error) {
    console.error('Error getting token balance:', error);
    return { balance: 0n, decimals: 18 };
  }
}

/**
 * Get all token holdings for a wallet (requires indexer or predefined token list)
 * For simplicity, we'll track tokens that were traded
 */
export async function getBaseTokenHoldings(
  address: string,
  trackedTokens: string[] = []
): Promise<TokenHolding[]> {
  const holdings: TokenHolding[] = [];
  
  if (trackedTokens.length === 0) {
    // Add some common Base tokens
    trackedTokens = [
      config.base.usdcAddress, // USDC
    ];
  }
  
  // Fetch token info
  const tokenInfoMap = await getMultipleTokensInfo(trackedTokens, 'base');
  
  for (const tokenAddress of trackedTokens) {
    try {
      const { balance, decimals } = await getTokenBalance(address, tokenAddress);
      
      if (balance > 0n) {
        const info = tokenInfoMap.get(tokenAddress.toLowerCase());
        const balanceFormatted = formatUnits(balance, decimals);
        const priceUsd = info?.priceUsd || '0';
        
        holdings.push({
          tokenAddress,
          symbol: info?.symbol || 'UNKNOWN',
          name: info?.name || 'Unknown Token',
          balance: balance.toString(),
          balanceFormatted,
          decimals,
          priceUsd,
          valueUsd: (parseFloat(balanceFormatted) * parseFloat(priceUsd)).toFixed(2),
          network: 'base',
        });
      }
    } catch (error) {
      console.error(`Error fetching balance for ${tokenAddress}:`, error);
    }
  }
  
  // Sort by USD value descending
  holdings.sort((a, b) => parseFloat(b.valueUsd) - parseFloat(a.valueUsd));
  
  return holdings;
}

// ============ LlamaSwap / 1inch Trading ============

/**
 * Get swap quote from LlamaSwap (free, no API key required)
 */
export async function getLlamaSwapQuote(
  fromToken: string,
  toToken: string,
  amount: string,
  slippageBps: number = 100
): Promise<SwapQuote | null> {
  try {
    // LlamaSwap aggregates multiple DEX aggregators
    const response = await swapApi.get('https://swap-api.defillama.com/aggregator/base/swap', {
      params: {
        tokenIn: fromToken,
        tokenOut: toToken,
        amount,
        slippage: slippageBps / 100, // Convert bps to percentage
      },
    });
    
    const data = response.data;
    
    return {
      inputToken: fromToken,
      outputToken: toToken,
      inputAmount: amount,
      outputAmount: data.amountOut || '0',
      outputAmountFormatted: data.amountOutFormatted || '0',
      priceImpact: data.priceImpact || '0',
      route: data.route || 'LlamaSwap',
    };
    
  } catch (error: any) {
    console.error('Error getting LlamaSwap quote:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Get swap quote from 1inch (requires API key for better rates)
 */
export async function get1inchQuote(
  fromToken: string,
  toToken: string,
  amount: string,
  slippageBps: number = 100
): Promise<SwapQuote | null> {
  if (!config.oneInchApiKey) {
    return getLlamaSwapQuote(fromToken, toToken, amount, slippageBps);
  }
  
  try {
    const response = await swapApi.get(`${config.oneInchApiUrl}/quote`, {
      params: {
        src: fromToken,
        dst: toToken,
        amount,
      },
      headers: {
        'Authorization': `Bearer ${config.oneInchApiKey}`,
      },
    });
    
    const data = response.data;
    
    return {
      inputToken: fromToken,
      outputToken: toToken,
      inputAmount: amount,
      outputAmount: data.dstAmount || '0',
      outputAmountFormatted: formatUnits(BigInt(data.dstAmount || '0'), 18),
      priceImpact: '0', // 1inch doesn't always return this
      route: '1inch',
    };
    
  } catch (error: any) {
    console.error('Error getting 1inch quote:', error.response?.data || error.message);
    // Fallback to LlamaSwap
    return getLlamaSwapQuote(fromToken, toToken, amount, slippageBps);
  }
}

/**
 * Execute a swap on Base using 1inch
 */
export async function execute1inchSwap(
  telegramUserId: number,
  fromToken: string,
  toToken: string,
  amount: string,
  slippageBps: number = 100
): Promise<TransactionResult> {
  try {
    const account = getBaseAccount(telegramUserId);
    if (!account) {
      return { success: false, error: 'Wallet not found' };
    }
    
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(config.baseRpcUrl),
    });
    
    // Check if we need to approve token spending (not needed for ETH)
    const isFromETH = fromToken.toLowerCase() === config.base.nativeToken.toLowerCase() ||
                       fromToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    
    if (!isFromETH) {
      // Check allowance
      const allowance = await publicClient.readContract({
        address: fromToken as Address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [account.address, AGGREGATION_ROUTER_V6 as Address],
      });
      
      if ((allowance as bigint) < BigInt(amount)) {
        // Approve max
        const approveHash = await walletClient.writeContract({
          address: fromToken as Address,
          abi: erc20Abi,
          functionName: 'approve',
          args: [AGGREGATION_ROUTER_V6 as Address, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
        });
        
        // Wait for approval
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
    }
    
    // Get swap transaction from 1inch
    let swapTx;
    
    if (config.oneInchApiKey) {
      const response = await swapApi.get(`${config.oneInchApiUrl}/swap`, {
        params: {
          src: fromToken,
          dst: toToken,
          amount,
          from: account.address,
          slippage: slippageBps / 100,
          disableEstimate: false,
        },
        headers: {
          'Authorization': `Bearer ${config.oneInchApiKey}`,
        },
      });
      
      swapTx = response.data.tx;
    } else {
      // Use LlamaSwap's transaction builder
      const response = await swapApi.get('https://swap-api.defillama.com/aggregator/base/swap', {
        params: {
          tokenIn: fromToken,
          tokenOut: toToken,
          amount,
          slippage: slippageBps / 100,
          userAddress: account.address,
        },
      });
      
      swapTx = response.data.tx;
    }
    
    if (!swapTx) {
      return { success: false, error: 'Failed to build swap transaction' };
    }
    
    // Execute the swap
    const hash = await walletClient.sendTransaction({
      to: swapTx.to as Address,
      data: swapTx.data as Hex,
      value: BigInt(swapTx.value || '0'),
      gas: swapTx.gas ? BigInt(swapTx.gas) : undefined,
    });
    
    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    if (receipt.status === 'reverted') {
      return {
        success: false,
        hash,
        error: 'Transaction reverted',
        explorerUrl: `${config.explorers.base}${hash}`,
      };
    }
    
    return {
      success: true,
      hash,
      explorerUrl: `${config.explorers.base}${hash}`,
    };
    
  } catch (error: any) {
    console.error('Error executing swap:', error);
    return {
      success: false,
      error: error.shortMessage || error.message || 'Swap failed',
    };
  }
}

/**
 * Buy a token with ETH
 */
export async function buyBaseToken(
  telegramUserId: number,
  tokenAddress: string,
  ethAmount: number,
  slippageBps: number = 100
): Promise<TransactionResult> {
  const weiAmount = parseEther(ethAmount.toString()).toString();
  
  return execute1inchSwap(
    telegramUserId,
    config.base.nativeToken, // ETH
    tokenAddress,
    weiAmount,
    slippageBps
  );
}

/**
 * Sell a token for ETH
 */
export async function sellBaseToken(
  telegramUserId: number,
  tokenAddress: string,
  tokenAmount: string,
  slippageBps: number = 100
): Promise<TransactionResult> {
  return execute1inchSwap(
    telegramUserId,
    tokenAddress,
    config.base.nativeToken, // ETH
    tokenAmount,
    slippageBps
  );
}

/**
 * Sell a percentage of token holdings
 */
export async function sellBaseTokenPercentage(
  telegramUserId: number,
  tokenAddress: string,
  percentage: number,
  slippageBps: number = 100
): Promise<TransactionResult> {
  try {
    const account = getBaseAccount(telegramUserId);
    if (!account) {
      return { success: false, error: 'Wallet not found' };
    }
    
    // Get token balance
    const { balance } = await getTokenBalance(account.address, tokenAddress);
    
    if (balance === 0n) {
      return { success: false, error: 'No token balance found' };
    }
    
    const sellAmount = (balance * BigInt(percentage)) / 100n;
    
    if (sellAmount === 0n) {
      return { success: false, error: 'Amount too small' };
    }
    
    return sellBaseToken(
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
