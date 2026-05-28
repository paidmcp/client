# paidmcp/client

Local proxy that lets Claude Desktop/Cursor use paid MCP servers that require x402 payment.

## Commands

- `paidmcp init` - create `~/.paidmcp/config.json` and wallet
- `paidmcp wallet` - print current wallet info
- `paidmcp connect <endpoint>` - print config snippet for MCP clients
- `paidmcp run <endpoint>` - run stdio MCP proxy

## Development

```bash
npm install
npm run build
node dist/cli.js init
```

Then run:

```bash
node dist/cli.js run https://your-mcp-host.dev
```
