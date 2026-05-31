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
    id: "init-facilitator-matrix",
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
    id: "facilitator-matrix-call",
    method: "tools/call",
    params: { name: "get_price", arguments: { id: "bitcoin" } },
  }),
});
const pr = http.getPaymentRequiredResponse((n) => first.headers.get(n), {});
const payload = await client.createPaymentPayload(pr);
const req = payload.accepted;

const facilitators = [
  ["Heurist", "https://facilitator.heurist.xyz"],
  ["Semantic", "https://x402.semanticpay.io"],
  ["CDP", "https://api.cdp.coinbase.com/platform/v2/x402"],
  ["x402.org", "https://x402.org/facilitator"],
];

for (const [name, base] of facilitators) {
  for (const path of ["/verify", "/settle"]) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x402Version: payload.x402Version,
          paymentPayload: payload,
          paymentRequirements: req,
        }),
      });
      const text = await res.text();
      console.log(`\n${name} ${path} -> ${res.status}`);
      console.log(text.slice(0, 300));
    } catch (e) {
      console.log(`\n${name} ${path} -> ERROR`, e.message);
    }
  }
}
