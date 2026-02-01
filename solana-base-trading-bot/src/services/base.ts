import * as security from './security';
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
export async function createBaseWallet(
  telegramUserId: number,
  password?: string
): Promise<{
  address: string;
  created: boolean;
  needsPassword?: boolean;
  error?: string;
}> {
  const existing = getWallet(telegramUserId, 'base');
  if (existing) {
    return { address: existing.address, created: false };
  }
  
  if (security.needsPasswordSetup(telegramUserId)) {
    return { address: '', created: false, error: 'Please set up security first with /security' };
  }
  
  if (!password) {
    return { address: '', created: false, needsPassword: true };
  }
  
  const privateKey = ('0x' + crypto.randomBytes(32).toString('hex')) as Hex;
  const account = privateKeyToAccount(privateKey);
  
  const result = security.createEncryptedWallet(telegramUserId, 'base', account.address, privateKey, password);
  if (!result.success) {
    return { address: '', created: false, error: result.error };
  }
  
  return { address: account.address, created: true };
}

export async function importBaseWallet(
  telegramUserId: number,
  privateKey: string,
  password?: string
): Promise<{ address: string; success: boolean; needsPassword?: boolean; error?: string }> {
  if (security.needsPasswordSetup(telegramUserId)) {
    return { address: '', success: false, error: 'Please set up security first with /security' };
  }
  
  if (!password) {
    return { address: '', success: false, needsPassword: true };
  }

  try {
    const key = (privateKey.startsWith('0x') ? privateKey : '0x' + privateKey) as Hex;
    const account = privateKeyToAccount(key);
    const result = security.createEncryptedWallet(telegramUserId, 'base', account.address, key, password);
    if (!result.success) {
      return { address: '', success: false, error: result.error };
    }
    return { address: account.address, success: true };
  } catch (error) {
    console.error('Error importing Base wallet:', error);
    return { address: '', success: false, error: 'Invalid private key format' };
  }
}


export function getBaseAccount(telegramUserId: number) {
  // Must be unlocked to use wallet
  const privateKey = security.getPrivateKey(telegramUserId, 'base');
  if (!privateKey) return null;
  
  try {
    return privateKeyToAccount(privateKey as Hex);
  } catch (error) {
    console.error('Error creating Base account:', error);
    return null;
  }
}

export function exportBasePrivateKey(telegramUserId: number): string | null {
  // Must be unlocked - returns key from session
  return security.getPrivateKey(telegramUserId, 'base');
}
// ============ Balance & Holdings ============

export async function getEthBalance(address: string): Promise<{
  wei: bigint;
  eth: string;
  usd: number;
}> {
  try {
    const wei = await publicClient.getBalance({ address: address as Address });
    const eth = formatEther(wei);
    
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

export async function getTokenBalance(
  walletAddress: string,
  tokenAddress: string
): Promise<{ balance: bigint; decimals: number }> {
  try {
    const [balance, decimals] = await Promise.all([
      (publicClient as any).readContract({
        address: tokenAddress as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [walletAddress as Address],
      }),
      (publicClient as any).readContract({
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

export async function getBaseTokenHoldings(
  address: string,
  trackedTokens: string[] = []
): Promise<TokenHolding[]> {
  const holdings: TokenHolding[] = [];
  
  if (!trackedTokens.includes(config.base.usdcAddress)) {
    trackedTokens.push(config.base.usdcAddress);
  }
  
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
  
  holdings.sort((a, b) => parseFloat(b.valueUsd) - parseFloat(a.valueUsd));
  return holdings;
}

// ============ Odos Trading ============

// Odos V2 Router on Base
const ODOS_ROUTER_V2 = '0x19cEeAd7105607Cd444F5ad10dd51356436095a1';
const ODOS_API_BASE = 'https://api.odos.xyz';

// Native ETH address used by Odos
const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

export async function getOdosQuote(
  fromToken: string,
  toToken: string,
  amount: string,
  userAddr: string,
  slippageBps: number = 100
): Promise<SwapQuote | null> {
  try {
    const inToken = fromToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      ? NATIVE_TOKEN_ADDRESS : fromToken;
    const outToken = toToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      ? NATIVE_TOKEN_ADDRESS : toToken;

    const response = await swapApi.post(`${ODOS_API_BASE}/sor/quote/v2`, {
      chainId: 8453,
      inputTokens: [{ tokenAddress: inToken, amount }],
      outputTokens: [{ tokenAddress: outToken, proportion: 1 }],
      slippageLimitPercent: slippageBps / 100,
      userAddr,
      referralCode: 0,
      compact: true,
    });

    const data = response.data;

    return {
      inputToken: fromToken,
      outputToken: toToken,
      inputAmount: amount,
      outputAmount: data.outAmounts?.[0] || '0',
      outputAmountFormatted: data.outAmounts?.[0] || '0',
      priceImpact: data.priceImpact?.toString() || '0',
      route: 'Odos',
    };
  } catch (error: any) {
    console.error('Error getting Odos quote:', error.response?.data || error.message);
    return null;
  }
}

export async function executeOdosSwap(
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

    const isFromETH = fromToken.toLowerCase() === config.base.nativeToken.toLowerCase() ||
                       fromToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

    if (!isFromETH) {
      const allowance = await (publicClient as any).readContract({
        address: fromToken as Address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [account.address, ODOS_ROUTER_V2 as Address],
      });

      if ((allowance as bigint) < BigInt(amount)) {
        console.log('Approving Odos router for', fromToken);
        const approveHash = await (walletClient as any).writeContract({
          address: fromToken as Address,
          abi: erc20Abi,
          functionName: 'approve',
          args: [ODOS_ROUTER_V2 as Address, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
          chain: base,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        console.log('Approval confirmed:', approveHash);
      }
    }

    const inToken = fromToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      ? NATIVE_TOKEN_ADDRESS : fromToken;
    const outToken = toToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      ? NATIVE_TOKEN_ADDRESS : toToken;

    console.log('Odos quote:', { inToken, outToken, amount, userAddr: account.address });

    const quoteResponse = await swapApi.post(`${ODOS_API_BASE}/sor/quote/v2`, {
      chainId: 8453,
      inputTokens: [{ tokenAddress: inToken, amount }],
      outputTokens: [{ tokenAddress: outToken, proportion: 1 }],
      slippageLimitPercent: slippageBps / 100,
      userAddr: account.address,
      referralCode: 0,
      compact: true,
    });

    const pathId = quoteResponse.data.pathId;
    if (!pathId) {
      console.error('No pathId in Odos quote response:', quoteResponse.data);
      return { success: false, error: 'Failed to get swap route' };
    }

    console.log('Odos pathId:', pathId, 'outAmounts:', quoteResponse.data.outAmounts);

    const assembleResponse = await swapApi.post(`${ODOS_API_BASE}/sor/assemble`, {
      pathId,
      userAddr: account.address,
    });

    const tx = assembleResponse.data.transaction;
    if (!tx) {
      console.error('No transaction in Odos assemble response:', assembleResponse.data);
      return { success: false, error: 'Failed to build swap transaction' };
    }

    console.log('Odos tx assembled, sending...');

    const hash = await (walletClient as any).sendTransaction({
      to: tx.to as Address,
      data: tx.data as Hex,
      value: BigInt(tx.value || '0'),
      gas: tx.gas ? BigInt(tx.gas) : undefined,
      chain: base,
    });

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
    console.error('Error executing Odos swap:', error.response?.data || error);
    return {
      success: false,
      error: error.shortMessage || error.message || 'Swap failed',
    };
  }
}

export async function buyBaseToken(
  telegramUserId: number,
  tokenAddress: string,
  ethAmount: number,
  slippageBps: number = 100
): Promise<TransactionResult> {
  const weiAmount = parseEther(ethAmount.toString()).toString();

  return executeOdosSwap(
    telegramUserId,
    config.base.nativeToken,
    tokenAddress,
    weiAmount,
    slippageBps
  );
}

export async function sellBaseToken(
  telegramUserId: number,
  tokenAddress: string,
  tokenAmount: string,
  slippageBps: number = 100
): Promise<TransactionResult> {
  return executeOdosSwap(
    telegramUserId,
    tokenAddress,
    config.base.nativeToken,
    tokenAmount,
    slippageBps
  );
}

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

// ============== Withdraw ==============

/**
 * Withdraw native ETH to an external address
 * Reserves 0.0005 ETH for gas fees
 */
export async function withdrawEth(
  telegramUserId: number,
  toAddress: string,
  amount: string // "all" or ETH amount
): Promise<TransactionResult> {
  const account = getBaseAccount(telegramUserId);
  if (!account) throw new Error('No Base wallet found');

  const balance = await getEthBalance(account.address);
  const GAS_RESERVE = 0.0005; // Reserve 0.0005 ETH for future gas

  let ethToSend: number;
  if (amount === 'all') {
    ethToSend = parseFloat(balance.eth) - GAS_RESERVE;
  } else {
    ethToSend = parseFloat(amount);
    if (parseFloat(balance.eth) - ethToSend < GAS_RESERVE) {
      ethToSend = parseFloat(balance.eth) - GAS_RESERVE;
    }
  }

  if (ethToSend <= 0) throw new Error(`Insufficient balance. Need to keep ${GAS_RESERVE} ETH for gas.`);

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(config.baseRpcUrl),
  });

  const hash = await (walletClient as any).sendTransaction({
    to: toAddress as Address,
    value: parseEther(ethToSend.toFixed(18)),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return {
    success: receipt.status === 'success',
    signature: hash,
    message: `Withdrew ${ethToSend.toFixed(6)} ETH`,
  };
}

/**
 * Withdraw ERC20 token to an external address
 */
export async function withdrawErc20Token(
  telegramUserId: number,
  tokenAddress: string,
  toAddress: string,
  amount: string, // "all" or token amount
  decimals: number
): Promise<TransactionResult> {
  const account = getBaseAccount(telegramUserId);
  if (!account) throw new Error('No Base wallet found');

  const { balance: rawBalance } = await getTokenBalance(account.address, tokenAddress);
  const tokenBalance = parseFloat(formatUnits(rawBalance, decimals));

  let tokensToSend: number;
  if (amount === 'all') {
    tokensToSend = tokenBalance;
  } else {
    tokensToSend = parseFloat(amount);
  }

  if (tokensToSend <= 0 || tokensToSend > tokenBalance) throw new Error('Insufficient token balance');

  const rawAmount = parseUnits(tokensToSend.toString(), decimals);

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(config.baseRpcUrl),
  });

  const hash = await (walletClient as any).writeContract({
    address: tokenAddress as Address,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [toAddress as Address, rawAmount],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return {
    success: receipt.status === 'success',
    signature: hash,
    message: `Withdrew ${tokensToSend} tokens`,
  };
}
