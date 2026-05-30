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

| Goal                                           | Command (run inside `client/`)                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Create payer wallet (`~/.paidmcp/config.json`) | `npm run init`                                                                   |
| Show payer wallet and balances                 | `npm run wallet`                                                                 |
| Print MCP config snippet                       | `npm run connect -- http://localhost:4021`                                       |
| Run stdio proxy                                | `npm run run -- http://localhost:4021`                                           |
| Run with MCP Inspector                         | `npx @modelcontextprotocol/inspector node dist/cli.js run http://localhost:4021` |

## Published usage (after npm release)

If the package is published, you can run:

```bash
npx paidmcp-client init
npx paidmcp-client wallet
npx paidmcp-client run https://your-mcp-host.dev
```

## Why `paidmcp: command not found` happens

`paidmcp` is a package binary. From a fresh clone it is not on your shell path. Use the from-source commands (`npm run init`, `npm run wallet`, `npm run run -- <endpoint>`) unless you installed globally, linked locally, or use `npx paidmcp-client`.

## Tests and debug utilities

Run inside `client/`:

| Goal                                   | Command                             | When to use                                                                   |
| -------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| Smoke test paid call end-to-end        | `npm run test:paid-fetch`           | You want one realistic paid request using your funded payer wallet.           |
| Inspect Base x402 flow in detail       | `npm run debug:x402-base`           | You need step-by-step 402, payload, verify, and settle behavior for Base.     |
| Inspect Plasma x402 flow in detail     | `npm run debug:x402-plasma`         | You are debugging the Plasma USDT0 route with Semantic facilitator.           |
| Compare Plasma facilitator behavior    | `npm run debug:plasma-facilitators` | You want side-by-side verify/settle responses for Plasma across facilitators. |
| Probe multiple facilitators quickly    | `npm run debug:facilitator-matrix`  | You need a broad compatibility snapshot for Base facilitator endpoints.       |
| Test settle with resource URL variants | `npm run debug:settle-resource-url` | You need to validate resource URL handling in settle responses.               |

Scripts are grouped by intent:

- `scripts/tests/*` for repeatable checks.
- `scripts/debug/*` for deep troubleshooting flows.

## License

MIT. See `LICENSE`.
