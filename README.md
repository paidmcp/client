# paidmcp-client

[![npm version](https://img.shields.io/npm/v/paidmcp-client)](https://www.npmjs.com/package/paidmcp-client)
[![license](https://img.shields.io/npm/l/paidmcp-client)](LICENSE)

`paidmcp-client` is an optional managed-wallet MCP proxy for x402-enabled MCP servers.

Use it when you want spend caps, payment approvals, and guided onboarding. You can also connect natively to `/mcp` without this proxy.

## Requirements

- Node.js 20+ (22 recommended)
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
npx paidmcp-client wallet:import --force --confirm OVERWRITE_PAIDMCP_CONFIG < seed.txt
npx paidmcp-client doctor <endpoint>
npx paidmcp-client connect <endpoint>
npx paidmcp-client run <endpoint>
```

Examples:

```bash
npx paidmcp-client connect http://localhost:4021
npx paidmcp-client run https://your-mcp-host.dev
```

Endpoints must use `https://` (plain `http://` is only allowed for `localhost`), so nobody on the network can change where a payment goes.

## Spend controls

Set in `~/.paidmcp/config.json` (amounts in US dollars):

| Setting            | Default | What it does                                                                                  |
| ------------------ | ------- | --------------------------------------------------------------------------------------------- |
| `maxPerCallUsdt`   | `0.25`  | Never pay more than this for one call                                                         |
| `maxSessionUsdt`   | `5`     | Total per running proxy (resets when the MCP client restarts it)                              |
| `maxDailyUsdt`     | `10`    | Total per UTC day across all proxies on this machine (kept in `~/.paidmcp/spend-ledger.json`) |
| `confirmAboveUsdt` | `0.05`  | Payments at or above this need your approval                                                  |

How payments are checked:

- **Approval:** the proxy asks through your MCP client's approval prompt (MCP elicitation). If the client cannot show prompts, the payment is refused with an explanation. It is never approved silently. To allow larger payments without a prompt, raise `confirmAboveUsdt`.
- **Tokens:** only USDC on Base (Base Sepolia in test mode) and, in live mode, USDT0 on Plasma, at their official contract addresses. A server asking for any other token is refused.
- **Caps are reserved before signing,** so parallel calls and multiple proxies cannot exceed them. A signed payment counts toward the caps even if the server never collects it.
- **Test mode never pays on Plasma**, which only has a mainnet.

Set `"networkMode": "live"` to pay on mainnet. RPC URLs and token addresses follow the mode automatically.

## Supported payment styles

Paid MCP servers ask for payment in different ways. The proxy handles all three that appear on [paidmcp.dev](https://paidmcp.dev), with the same caps and approvals:

| Style                                                                                                       | How the server asks                                  | How the proxy pays                                                              |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| HTTP 402 (e.g. [paidmcp/template](https://github.com/paidmcp/template))                                     | the `/mcp` request gets HTTP 402                     | retries the request with a `PAYMENT-SIGNATURE` header                           |
| x402 MCP transport ([official spec](https://github.com/coinbase/x402/blob/main/specs/transports-v2/mcp.md)) | a tool result containing `{ x402Version, accepts }`  | retries the tool call once with `_meta["x402/payment"]`                         |
| Payment link                                                                                                | a tool result with `{ url, status: 402, challenge }` | pays that URL over HTTP 402 and returns its response (same host and https only) |

The proxy pays at most once per tool call. If a server asks again after being paid, the call fails with an explanation instead of paying again.

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
npm run wallet:import -- --force --confirm OVERWRITE_PAIDMCP_CONFIG < seed.txt
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
- before overwrite, a timestamped backup is created in `~/.paidmcp/` as `config.backup-*.json` (readable only by you)
- your existing settings (mode, caps) are kept; only the seed phrase changes
- `wallet:import` checks that the seed phrase is valid before changing anything, and reads it from stdin when not given as an argument (arguments can end up in shell history)

### No balance / payment failure

- verify your wallet has funded USDC (Base) or USDT0 (Plasma)
- verify endpoint URL and network availability
- run `npx paidmcp-client wallet` to confirm balances are readable
- run `npx paidmcp-client doctor <endpoint>` for a quick endpoint check

### Spend limits or confirmation stopped a call

- the tool result says which limit stopped it
- adjust `maxPerCallUsdt`, `maxSessionUsdt`, `maxDailyUsdt` or `confirmAboveUsdt` in `~/.paidmcp/config.json`
- restart the MCP client after changing config

## Security notes

- `~/.paidmcp/config.json` contains your seed phrase in plaintext. It is created readable only by you (mode 600).
- Never commit or share this file.
- Back up your seed phrase securely. Losing it means losing access to funds.

## License

MIT. See `LICENSE`.
