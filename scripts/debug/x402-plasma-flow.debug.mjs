/**
 * Full x402 flow forcing Plasma USDT0 + Semantic facilitator.
 * Requires funded Plasma USDT0 on the payer wallet.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mnemonicToAccount } from "viem/accounts";
import { ExactEvmScheme } from "@x402/evm";
import { x402Client, x402HTTPClient } from "@x402/fetch";

const PLASMA = "eip155:9745";
const SEMANTIC = "https://x402.semanticpay.io";
const endpoint = process.argv[2] ?? "http://localhost:4021";
const mcpUrl = endpoint.endsWith("/mcp")
  ? endpoint
  : `${endpoint.replace(/\/+$/, "")}/mcp`;

const cfg = JSON.parse(
  readFileSync(join(homedir(), ".paidmcp", "config.json"), "utf-8"),
);
const account = mnemonicToAccount(cfg.seedPhrase);
const signer = {
  address: account.address,
  signTypedData: (m) => account.signTypedData(m),
};

const selectPlasma = (_v, reqs) => {
  const picked = reqs.find((r) => r.network === PLASMA) ?? reqs[0];
  console.log("Selected:", picked.network, picked.amount, picked.asset);
  return picked;
};

const client = new x402Client(selectPlasma).register(
  PLASMA,
  new ExactEvmScheme(signer),
);
const httpClient = new x402HTTPClient(client);

const init = await fetch(mcpUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "init-plasma-debug",
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
const callBody = JSON.stringify({
  jsonrpc: "2.0",
  id: "plasma-debug-call",
  method: "tools/call",
  params: { name: "get_price", arguments: { id: "bitcoin" } },
});

const first = await fetch(mcpUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "mcp-session-id": sessionId,
    "x-paidmcp-trial": "false",
  },
  body: callBody,
});
console.log("\n=== STEP 1: unpaid ===");
console.log("status:", first.status);
const paymentRequired = httpClient.getPaymentRequiredResponse(
  (n) => first.headers.get(n),
  first.status === 402 ? {} : undefined,
);
const plasmaAccept = paymentRequired.accepts.find((a) => a.network === PLASMA);
if (!plasmaAccept) {
  console.error("Server did not offer Plasma USDT0 payment option.");
  process.exit(1);
}

const paymentPayload = await client.createPaymentPayload({
  ...paymentRequired,
  accepts: [plasmaAccept],
});
console.log("\n=== STEP 2: signed Plasma payload ===");
console.log(JSON.stringify(paymentPayload, null, 2));

const requirements = paymentPayload.accepted;
const body = JSON.stringify({
  x402Version: paymentPayload.x402Version,
  paymentPayload,
  paymentRequirements: requirements,
});

for (const path of ["/verify", "/settle"]) {
  const res = await fetch(`${SEMANTIC}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  console.log(`\n=== STEP 3: Semantic ${path} ===`);
  console.log("status:", res.status);
  console.log(await res.text());
}

const payHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
const paid = await fetch(mcpUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "mcp-session-id": sessionId,
    "x-paidmcp-trial": "false",
    ...payHeaders,
  },
  body: callBody,
});
console.log("\n=== STEP 4: paid request to server (Plasma) ===");
console.log("status:", paid.status);
const pr = paid.headers.get("payment-response");
if (pr)
  console.log("PAYMENT-RESPONSE:", Buffer.from(pr, "base64").toString("utf8"));
console.log("body:", await paid.text());
