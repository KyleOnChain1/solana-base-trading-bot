import { Network } from './index';

export type TriggerType = 'price' | 'marketcap';
export type TriggerCondition = 'above' | 'below';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'active' | 'triggered' | 'executed' | 'failed' | 'cancelled';

export interface TriggerOrder {
  id: number;
  telegramUserId: number;
  chatId: number;
  network: Network;
  tokenAddress: string;
  tokenSymbol: string;
  
  // Order configuration
  side: OrderSide;
  triggerType: TriggerType;
  triggerCondition: TriggerCondition;
  triggerValue: number; // USD price or market cap
  
  // Amount to trade
  // For buys: amount in SOL/ETH
  // For sells: percentage of holdings (1-100)
  amount: string;
  amountType: 'fixed' | 'percentage';
  
  // Execution settings
  slippageBps: number;
  
  // State
  status: OrderStatus;
  priceAtCreation: number;
  
  // Timestamps
  createdAt: string;
  triggeredAt?: string;
  executedAt?: string;
  
  // Execution result
  txHash?: string;
  executionPrice?: number;
  error?: string;
}

export interface CreateTriggerOrderParams {
  telegramUserId: number;
  chatId: number;
  network: Network;
  tokenAddress: string;
  tokenSymbol: string;
  side: OrderSide;
  triggerType: TriggerType;
  triggerCondition: TriggerCondition;
  triggerValue: number;
  amount: string;
  amountType: 'fixed' | 'percentage';
  slippageBps?: number;
  currentPrice: number;
}

// Pending order creation state
export interface PendingTriggerOrder {
  stage: 'select_type' | 'select_trigger' | 'enter_price' | 'enter_amount' | 'confirm';
  network?: Network;
  tokenAddress?: string;
  tokenSymbol?: string;
  side?: OrderSide;
  triggerType?: TriggerType;
  triggerCondition?: TriggerCondition;
  triggerValue?: number;
  amount?: string;
  amountType?: 'fixed' | 'percentage';
  currentPrice?: number;
  currentMcap?: number;
}
