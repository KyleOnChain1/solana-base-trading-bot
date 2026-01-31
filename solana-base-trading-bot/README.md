# Solana & Base Trading Bot for Telegram

A powerful Telegram trading bot that enables you to trade tokens on **Solana** and **Base** networks directly from your Telegram chat. Similar to popular bots like Trojan and Unibot, but self-hosted for maximum security and control.

## Features

### 🔐 Wallet Management
- Create new wallets for Solana and Base networks
- Import existing wallets using private keys
- Encrypted private key storage using AES-256-CBC
- Export private keys for backup

### 💰 Trading
- **Buy tokens** with SOL (Solana) or ETH (Base)
- **Sell tokens** for SOL or ETH
- Percentage-based selling (25%, 50%, 75%, 100%)
- Custom amount trading
- Configurable slippage tolerance
- Priority fee settings for Solana

### 📊 Portfolio Tracking
- View all token holdings in real-time
- See current USD values
- Track transaction history

### 🔗 DEX Aggregators
- **Solana**: Jupiter API for best swap rates
- **Base**: 1inch API or LlamaSwap (no API key required)

### 📈 Token Information
- Automatic token detection from contract address
- Price, market cap, liquidity, and volume data
- 24h price change indicators
- Data sourced from DexScreener

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Telegram      │────▶│   Trading Bot    │────▶│   DEX APIs      │
│   User          │     │   (Node.js)      │     │   Jupiter/1inch │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                    ┌──────────┼──────────┐
                    │          │          │
               ┌────▼────┐ ┌───▼───┐ ┌────▼────┐
               │ SQLite  │ │Solana │ │  Base   │
               │   DB    │ │  RPC  │ │   RPC   │
               └─────────┘ └───────┘ └─────────┘
```

## Prerequisites

- **Node.js** 20.x or higher
- **npm** or **yarn** or **pnpm**
- **Telegram Bot Token** from [@BotFather](https://t.me/BotFather)
- **RPC Endpoints** (free or paid)
  - Solana: Helius, QuickNode, Alchemy, or public RPC
  - Base: Alchemy, QuickNode, or public RPC
- **(Optional)** 1inch API key for better Base swap rates

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/solana-base-trading-bot.git
cd solana-base-trading-bot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Required: Get from @BotFather on Telegram
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Required: Generate with the command below
WALLET_ENCRYPTION_KEY=your_64_char_hex_key

# Solana RPC (use a paid RPC for production)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Base RPC (use a paid RPC for production)
BASE_RPC_URL=https://mainnet.base.org

# Optional: 1inch API key for better Base swap rates
ONEINCH_API_KEY=

# Default settings
DEFAULT_SLIPPAGE_BPS=100
DEFAULT_PRIORITY_FEE_LAMPORTS=100000
```

### 4. Generate Encryption Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output to `WALLET_ENCRYPTION_KEY` in your `.env` file.

### 5. Build and Run

```bash
# Development mode with hot reload
npm run dev

# Production build
npm run build
npm start
```

## Usage

### Getting Started

1. Start a chat with your bot on Telegram
2. Send `/start` to see the main menu
3. Create or import a wallet for Solana or Base

### Trading Tokens

**Method 1: Paste Contract Address**
1. Simply paste a token contract address
2. Bot will show token info for verification
3. Confirm and select buy amount
4. Execute the trade

**Method 2: Use Menu**
1. Click "🛒 Buy Token" or "💸 Sell Token"
2. Select network (Solana or Base)
3. Follow the prompts

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Show main menu |
| `/wallet` | Manage wallets |
| `/holdings` | View token holdings |
| `/buy` | Buy a token |
| `/sell` | Sell a token |
| `/settings` | Configure settings |
| `/history` | View transaction history |
| `/help` | Show help |

## Deployment

### Option 1: Deploy on a VPS

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and setup
git clone https://github.com/yourusername/solana-base-trading-bot.git
cd solana-base-trading-bot
npm install
npm run build

# Use PM2 for process management
npm install -g pm2
pm2 start dist/index.js --name trading-bot
pm2 save
pm2 startup
```

### Option 2: Deploy on Railway/Render/Fly.io

1. Connect your GitHub repository
2. Set environment variables in the dashboard
3. Deploy automatically on push

### Option 3: Docker

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
COPY .env ./

CMD ["node", "dist/index.js"]
```

```bash
docker build -t trading-bot .
docker run -d --name trading-bot --env-file .env trading-bot
```

## Security Considerations

⚠️ **Important Security Notes:**

1. **Private Keys**: All private keys are encrypted with AES-256-CBC before storage. The encryption key must be kept secure.

2. **Environment Variables**: Never commit `.env` files. Use secure secret management in production.

3. **RPC Endpoints**: Use dedicated RPC endpoints in production. Public RPCs have rate limits and may be unreliable.

4. **Database**: The SQLite database contains encrypted wallet data. Secure access to the data directory.

5. **Bot Token**: Keep your Telegram bot token secret. Regenerate if compromised.

6. **Self-Hosted**: This bot is designed to be self-hosted. Never use trading bots hosted by untrusted third parties.

## Troubleshooting

### Common Issues

**"Transaction failed"**
- Increase slippage tolerance in settings
- Ensure sufficient balance for gas fees
- Check if token has enough liquidity

**"Wallet not found"**
- Create a wallet first with `/wallet`

**"Token not found"**
- Verify the contract address is correct
- Check if the token has trading pairs on DEXes

**"Rate limited"**
- Use a paid RPC endpoint
- Wait and retry

### Logs

View logs for debugging:
```bash
# If using PM2
pm2 logs trading-bot

# If running directly
npm run dev
```

## API Documentation

### Jupiter (Solana)
- Endpoint: `https://quote-api.jup.ag/v6`
- [Documentation](https://station.jup.ag/docs/apis/swap-api)

### 1inch (Base)
- Endpoint: `https://api.1inch.dev/swap/v6.1/8453`
- [Documentation](https://portal.1inch.dev/documentation/apis/swap)

### DexScreener
- Endpoint: `https://api.dexscreener.com`
- [Documentation](https://docs.dexscreener.com/api/reference)

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - See [LICENSE](LICENSE) for details.

## Disclaimer

⚠️ **IMPORTANT DISCLAIMER:**

This software is provided "as is" without warranty of any kind. Trading cryptocurrencies involves significant risk of loss. By using this bot, you acknowledge that:

- You are solely responsible for your trading decisions
- Cryptocurrency trading can result in loss of funds
- The developers are not liable for any losses
- You should never invest more than you can afford to lose
- This bot is for educational purposes and personal use

Always do your own research before trading any cryptocurrency.

## Support

- Create an issue on GitHub for bugs or feature requests
- Star the repository if you find it useful!
