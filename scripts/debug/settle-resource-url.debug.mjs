import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mnemonicToAccount } from "viem/accounts";
import { ExactEvmScheme } from "@x402/evm";
import { x402Client, x402HTTPClient } from "@x402/fetch";

const cfg = JSON.parse(
  readFileSync(join(homedir(), ".paidmcp", "config.json"), "utf-8"),
);
const account = mnemonicToAccount(cfg.seedPhrase);
const signer = {
  address: account.address,
  signTypedData: (m) => account.signTypedData(m),
};
const client = new x402Client((_v, r) => r[0]).register(
  "eip155:8453",
  new ExactEvmScheme(signer),
);
const http = new x402HTTPClient(client);

const endpoint = process.argv[2] ?? "http://localhost:4021";
const mcpUrl = endpoint.endsWith("/mcp")
  ? endpoint
  : `${endpoint.replace(/\/+$/, "")}/mcp`;

const init = await fetch(mcpUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "init-settle-resource-url",
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "paidmcp-debug", version: "0.1.0" },
    },
  }),
});
if (!init.ok) {
  throw new Error(`MCP initialize failed: ${init.status} ${await init.text()}`);
}
const sessionId = init.headers.get("mcp-session-id");
if (!sessionId) {
  throw new Error("MCP initialize response missing mcp-session-id header");
}

const first = await fetch(mcpUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "mcp-session-id": sessionId,
    "x-paidmcp-trial": "false",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "settle-resource-url-call",
    method: "tools/call",
    params: { name: "get_price", arguments: { id: "bitcoin" } },
  }),
});
const pr = http.getPaymentRequiredResponse((n) => first.headers.get(n), {});
const payload = await client.createPaymentPayload(pr);
const req = payload.accepted;

async function settle(label, p) {
  const res = await fetch("https://facilitator.heurist.xyz/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      x402Version: p.x402Version,
      paymentPayload: p,
      paymentRequirements: req,
    }),
  });
  console.log(label, res.status, await res.text());
}

await settle("localhost resource", payload);
const pub = {
  ...payload,
  resource: {
    ...payload.resource,
    url: "https://crypto-prices.paidmcp.dev/mcp",
  },
};
await settle("public https resource", pub);
