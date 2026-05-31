# paidmcp-client

[![npm version](https://img.shields.io/npm/v/paidmcp-client)](https://www.npmjs.com/package/paidmcp-client)
[![license](https://img.shields.io/npm/l/paidmcp-client)](LICENSE)

`paidmcp-client` is an optional managed-wallet MCP proxy for x402-enabled MCP servers.

Use it when you want spend caps, confirmations, and guided onboarding. You can also connect natively to `/mcp` without this proxy.

## Requirements

- Node.js 20+
- npm

## Install

Use one of these options:

```bash
# run without installing globally
npx paidmcp-client --help

# or install globally
npm install -g paidmcp-client
```

After global install, use the `paidmcp` command directly:

```bash
paidmcp --help
```

## Quick start

1. Create a local payer wallet config:

```bash
npx paidmcp-client init
```

This creates `~/.paidmcp/config.json` with:

- your seed phrase
- testnet defaults (Base Sepolia) plus spend guardrails

2. Check wallet address and balances:

```bash
npx paidmcp-client wallet
```

3. Fund the wallet (testnet first, then live if needed).

4. Connect to your paid MCP endpoint:

```bash
npx paidmcp-client connect https://your-mcp-host.dev
```

5. Add the printed snippet to your MCP client config (Cursor or Claude Desktop).

## CLI commands

```bash
npx paidmcp-client init
npx paidmcp-client wallet
npx paidmcp-client wallet:import "<seed phrase>" --force --confirm OVERWRITE_PAIDMCP_CONFIG
npx paidmcp-client doctor <endpoint>
npx paidmcp-client connect <endpoint>
npx paidmcp-client run <endpoint>
```

Examples:

```bash
npx paidmcp-client connect http://localhost:4021
npx paidmcp-client run https://your-mcp-host.dev
```

## Configure Cursor or Claude Desktop

Generate a config snippet for a paid MCP endpoint:

```bash
npx paidmcp-client connect https://your-mcp-host.dev
```

The command prints JSON like:

```json
{
  "mcpServers": {
    "your-mcp-host-dev": {
      "command": "npx",
      "args": ["paidmcp-client", "run", "https://your-mcp-host.dev"]
    }
  }
}
```

Paste this into your MCP config file and restart your MCP client if needed.

## Local development (from source)

Inside `client/`:

```bash
npm install
npm run build
```

Run commands from source:

```bash
npm run init
npm run wallet
npm run wallet:import -- "<seed phrase>" --force --confirm OVERWRITE_PAIDMCP_CONFIG
npm run doctor -- http://localhost:4021
npm run connect -- http://localhost:4021
npm run run -- http://localhost:4021
```

## Troubleshooting

### `paidmcp: command not found`

Use one of:

- `npx paidmcp-client <command>`
- `npm install -g paidmcp-client` then `paidmcp <command>`
- from source: `npm run <script>`

### Missing config error

If you see an error like `Run "paidmcp init" first`, create the local config:

```bash
npx paidmcp-client init
```

### Overwrite protection

- when `~/.paidmcp/config.json` already exists, `init` / `wallet:import` will not overwrite by default
- overwrite requires both `--force` and `--confirm OVERWRITE_PAIDMCP_CONFIG`
- before overwrite, a timestamped backup is created in `~/.paidmcp/` as `config.backup-*.json`

### No balance / payment failure

- verify your wallet has funded USDC (Base) or USDT0 (Plasma)
- verify endpoint URL and network availability
- run `npx paidmcp-client wallet` to confirm balances are readable
- run `npx paidmcp-client doctor <endpoint>` for a quick endpoint check

### Spend limits or confirmation stopped a call

- adjust `maxPerCallUsdt`, `maxSessionUsdt`, and `confirmAboveUsdt` in `~/.paidmcp/config.json`
- restart the MCP client after changing config

## Security notes

- `~/.paidmcp/config.json` contains your seed phrase in plaintext.
- Never commit or share this file.
- Back up your seed phrase securely. Losing it means losing access to funds.

## License

MIT. See `LICENSE`.
