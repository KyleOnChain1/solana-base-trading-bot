import axios from 'axios';
import { config } from '../config';
import { TokenInfo, DexScreenerResponse, DexScreenerPair, Network } from '../types';

const api = axios.create({
  baseURL: config.dexScreenerApiUrl,
  timeout: 10000,
});

/**
 * Get token information from DexScreener
 */
export async function getTokenInfo(tokenAddress: string, network: Network): Promise<TokenInfo | null> {
  try {
    const chainId = network === 'solana' ? 'solana' : 'base';
    
    // Try tokens endpoint first
    const response = await api.get<DexScreenerPair[]>(
      `/tokens/v1/${chainId}/${tokenAddress}`
    );
    
    if (!response.data || response.data.length === 0) {
      // Try search endpoint as fallback
      const searchResponse = await api.get<DexScreenerResponse>(
        `/latest/dex/search?q=${tokenAddress}`
      );
      
      if (!searchResponse.data.pairs || searchResponse.data.pairs.length === 0) {
        return null;
      }
      
      // Find pair matching our token and network
      const pair = searchResponse.data.pairs.find(
        p => p.chainId === chainId && 
             (p.baseToken.address.toLowerCase() === tokenAddress.toLowerCase() ||
              p.quoteToken.address.toLowerCase() === tokenAddress.toLowerCase())
      );
      
      if (!pair) return null;
      
      return extractTokenInfo(pair, tokenAddress, network);
    }
    
    // Use the first pair (highest liquidity usually)
    const pair = response.data[0];
    return extractTokenInfo(pair, tokenAddress, network);
    
  } catch (error) {
    console.error('Error fetching token info from DexScreener:', error);
    return null;
  }
}

/**
 * Search for tokens by name or symbol
 */
export async function searchTokens(query: string, network?: Network): Promise<TokenInfo[]> {
  try {
    const response = await api.get<DexScreenerResponse>(
      `/latest/dex/search?q=${encodeURIComponent(query)}`
    );
    
    if (!response.data.pairs) return [];
    
    const chainFilter = network === 'solana' ? 'solana' : network === 'base' ? 'base' : null;
    
    const pairs = response.data.pairs
      .filter(p => !chainFilter || p.chainId === chainFilter)
      .slice(0, 10);
    
    return pairs.map(pair => extractTokenInfo(
      pair, 
      pair.baseToken.address,
      pair.chainId === 'solana' ? 'solana' : 'base'
    )).filter((t): t is TokenInfo => t !== null);
    
  } catch (error) {
    console.error('Error searching tokens:', error);
    return [];
  }
}

/**
 * Get multiple tokens info at once
 */
export async function getMultipleTokensInfo(
  tokenAddresses: string[], 
  network: Network
): Promise<Map<string, TokenInfo>> {
  const result = new Map<string, TokenInfo>();
  
  if (tokenAddresses.length === 0) return result;
  
  try {
    const chainId = network === 'solana' ? 'solana' : 'base';
    const addresses = tokenAddresses.slice(0, 30).join(',');
    
    const response = await api.get<DexScreenerPair[]>(
      `/tokens/v1/${chainId}/${addresses}`
    );
    
    if (response.data) {
      for (const pair of response.data) {
        const info = extractTokenInfo(pair, pair.baseToken.address, network);
        if (info) {
          result.set(info.address.toLowerCase(), info);
        }
      }
    }
    
  } catch (error) {
    console.error('Error fetching multiple tokens info:', error);
  }
  
  return result;
}

/**
 * Extract TokenInfo from a DexScreener pair
 */
function extractTokenInfo(
  pair: DexScreenerPair, 
  tokenAddress: string,
  network: Network
): TokenInfo | null {
  try {
    const isBaseToken = pair.baseToken.address.toLowerCase() === tokenAddress.toLowerCase();
    const token = isBaseToken ? pair.baseToken : pair.quoteToken;
    
    return {
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      decimals: network === 'solana' ? 9 : 18, // Default, may need adjustment
      priceUsd: pair.priceUsd || '0',
      priceNative: pair.priceNative || '0',
      fdv: pair.fdv,
      marketCap: pair.marketCap,
      volume24h: pair.volume?.h24,
      priceChange24h: pair.priceChange?.h24,
      liquidity: pair.liquidity?.usd,
      logoUrl: pair.info?.imageUrl,
      network,
    };
  } catch (error) {
    console.error('Error extracting token info:', error);
    return null;
  }
}

/**
 * Format token info for Telegram display
 */
export function formatTokenInfoMessage(token: TokenInfo): string {
  const lines = [
    `🪙 *${escapeMarkdown(token.name)}* (${escapeMarkdown(token.symbol)})`,
    ``,
    `📍 *Network:* ${token.network === 'solana' ? 'Solana' : 'Base'}`,
    `📋 *Address:*`,
    `\`${token.address}\``,
    ``,
    `💵 *Price:* $${formatPrice(token.priceUsd)}`,
  ];
  
  if (token.priceChange24h !== undefined) {
    const change = token.priceChange24h;
    const emoji = change >= 0 ? '🟢' : '🔴';
    const sign = change >= 0 ? '+' : '';
    lines.push(`📊 *24h Change:* ${emoji} ${sign}${change.toFixed(2)}%`);
  }
  
  if (token.volume24h) {
    lines.push(`📈 *24h Volume:* $${formatLargeNumber(token.volume24h)}`);
  }
  
  if (token.liquidity) {
    lines.push(`💧 *Liquidity:* $${formatLargeNumber(token.liquidity)}`);
  }
  
  if (token.marketCap) {
    lines.push(`🏛 *Market Cap:* $${formatLargeNumber(token.marketCap)}`);
  }
  
  if (token.fdv) {
    lines.push(`📊 *FDV:* $${formatLargeNumber(token.fdv)}`);
  }
  
  return lines.join('\n');
}

// Helper functions
function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

function formatPrice(price: string): string {
  const num = parseFloat(price);
  if (num === 0) return '0';
  if (num < 0.00000001) return num.toExponential(2);
  if (num < 0.0001) return num.toFixed(8);
  if (num < 0.01) return num.toFixed(6);
  if (num < 1) return num.toFixed(4);
  return num.toFixed(2);
}

function formatLargeNumber(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toFixed(2);
}
