# paidmcp/client

Local stdio proxy that lets Cursor and Claude Desktop call paid MCP servers protected by x402.

## Prerequisites

- Node.js 20+
- npm

## Install from source (this repository)

Run inside `client/`:

```bash
npm install
npm run build
```

### Commands (from source)

| Goal | Command (run inside `client/`) |
|------|--------------------------------|
| Create payer wallet (`~/.paidmcp/config.json`) | `npm run init` |
| Show payer wallet and balances | `npm run wallet` |
| Print MCP config snippet | `npm run connect -- http://localhost:4021` |
| Run stdio proxy | `npm run run -- http://localhost:4021` |
| Run with MCP Inspector | `npx @modelcontextprotocol/inspector node dist/cli.js run http://localhost:4021` |

## Published usage (after npm release)

If the package is published, you can run:

```bash
npx paidmcp-client init
npx paidmcp-client wallet
npx paidmcp-client run https://your-mcp-host.dev
```

## Why `paidmcp: command not found` happens

`paidmcp` is a package binary. From a fresh clone it is not on your shell path. Use the from-source commands (`npm run init`, `npm run wallet`, `npm run run -- <endpoint>`) unless you installed globally, linked locally, or use `npx paidmcp-client`.

## Debug scripts

Run inside `client/`:

| Script | Purpose |
|--------|---------|
| `node scripts/test-paid-fetch.mjs http://localhost:4021/tools/get_price` | Production-like paid fetch using real wallet balances. |
| `node scripts/debug-x402-flow.mjs` | Deep 402/verify/settle debug for Base route behavior. |
| `node scripts/debug-plasma-flow.mjs` | Force Plasma USDT0 + Semantic facilitator path. |
