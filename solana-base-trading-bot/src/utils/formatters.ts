import { Network } from '../types';
import { config } from '../config';

/**
 * Format a number with commas and specified decimal places
 */
export function formatNumber(num: number | string, decimals: number = 2): string {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '0';
  
  if (n >= 1_000_000_000) {
    return (n / 1_000_000_000).toFixed(2) + 'B';
  }
  if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(2) + 'M';
  }
  if (n >= 1_000) {
    return (n / 1_000).toFixed(2) + 'K';
  }
  
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format USD value
 */
export function formatUsd(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(n)) return '$0.00';
  
  if (n < 0.01 && n > 0) {
    return '$' + n.toFixed(6);
  }
  
  return '$' + formatNumber(n, 2);
}

/**
 * Format token amount with appropriate decimals
 */
export function formatTokenAmount(amount: string | number, decimals: number): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(n)) return '0';
  
  const formatted = n / Math.pow(10, decimals);
  
  if (formatted < 0.000001) {
    return formatted.toExponential(4);
  }
  
  if (formatted < 1) {
    return formatted.toFixed(6);
  }
  
  return formatNumber(formatted, 4);
}

/**
 * Format percentage change with color indicator
 */
export function formatPercentChange(percent: number | undefined): string {
  if (percent === undefined || isNaN(percent)) return 'N/A';
  
  const sign = percent >= 0 ? '+' : '';
  const emoji = percent >= 0 ? '🟢' : '🔴';
  
  return `${emoji} ${sign}${percent.toFixed(2)}%`;
}

/**
 * Truncate address for display
 */
export function truncateAddress(address: string, chars: number = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Get explorer URL for a transaction
 */
export function getExplorerUrl(txHash: string, network: Network): string {
  return config.explorers[network] + txHash;
}

/**
 * Format time ago
 */
export function formatTimeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);
  
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Escape markdown special characters for Telegram
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

/**
 * Validate Solana address
 */
export function isValidSolanaAddress(address: string): boolean {
  // Solana addresses are base58 encoded and 32-44 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

/**
 * Validate Ethereum/Base address
 */
export function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Detect network from address format
 */
export function detectNetworkFromAddress(address: string): Network | null {
  if (isValidEvmAddress(address)) return 'base';
  if (isValidSolanaAddress(address)) return 'solana';
  return null;
}

/**
 * Parse amount string (supports k, m, b suffixes)
 */
export function parseAmount(amountStr: string): number | null {
  const cleaned = amountStr.toLowerCase().trim();
  
  const match = cleaned.match(/^(\d+(?:\.\d+)?)(k|m|b)?$/);
  if (!match) return null;
  
  let amount = parseFloat(match[1]);
  const suffix = match[2];
  
  if (suffix === 'k') amount *= 1_000;
  if (suffix === 'm') amount *= 1_000_000;
  if (suffix === 'b') amount *= 1_000_000_000;
  
  return amount;
}
