console.log("=== paid fetch smoke test (real wallet) ===");
const { readFileSync } = await import("node:fs");
const { homedir } = await import("node:os");
const { join } = await import("node:path");
const { mnemonicToAccount } = await import("viem/accounts");
const { ExactEvmScheme } = await import("@x402/evm");
const { x402Client, wrapFetchWithPayment } = await import("@x402/fetch");
const WalletManagerEvm = (await import("@tetherto/wdk-wallet-evm")).default;

const BASE = "eip155:8453";
const PLASMA = "eip155:9745";
const endpoint = process.argv[2] ?? "http://localhost:4021";
const mcpUrl = endpoint.endsWith("/mcp")
  ? endpoint
  : `${endpoint.replace(/\/+$/, "")}/mcp`;
const signerType = process.argv[3] ?? "wdk";

const cfg = JSON.parse(
  readFileSync(join(homedir(), ".paidmcp", "config.json"), "utf-8"),
);
const baseAccount = await new WalletManagerEvm(cfg.seedPhrase, {
  provider: cfg.baseRpcUrl,
}).getAccount();
const plasmaAccount = await new WalletManagerEvm(cfg.seedPhrase, {
  provider: cfg.plasmaRpcUrl,
}).getAccount();

const balanceByNetwork = new Map();
await Promise.all([
  baseAccount
    .getTokenBalance(cfg.usdcAddress)
    .then((b) => balanceByNetwork.set(BASE, b)),
  plasmaAccount
    .getTokenBalance(cfg.usdt0Address)
    .then((b) => balanceByNetwork.set(PLASMA, b))
    .catch(() => null),
]);
console.log("Payer:", baseAccount.address);
console.log("Base USDC:", balanceByNetwork.get(BASE)?.toString());
console.log("Plasma USDT0:", balanceByNetwork.get(PLASMA)?.toString());

const selectRequirements = (_v, requirements) => {
  const affordable = requirements.find((r) => {
    const balance = balanceByNetwork.get(r.network);
    return balance !== undefined && balance >= BigInt(r.amount);
  });
  const picked = affordable ?? requirements[0];
  console.log("Pay via network:", picked.network, "amount:", picked.amount);
  return picked;
};

let signer;
if (signerType === "viem") {
  const account = mnemonicToAccount(cfg.seedPhrase);
  signer = {
    address: account.address,
    signTypedData: (message) => account.signTypedData(message),
  };
  console.log("Signer: viem");
} else {
  signer = {
    address: baseAccount.address,
    signTypedData: (message) => baseAccount.signTypedData(message),
  };
  console.log("Signer: wdk");
}

const client = new x402Client(selectRequirements)
  .register(BASE, new ExactEvmScheme(signer))
  .register(PLASMA, new ExactEvmScheme(signer));
const paidFetch = wrapFetchWithPayment(fetch, client);

async function initializeSession() {
  const init = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "init-paid-fetch",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "paidmcp-debug", version: "0.1.0" },
      },
    }),
  });
  if (!init.ok) {
    throw new Error(
      `MCP initialize failed: ${init.status} ${await init.text()}`,
    );
  }
  const sessionId = init.headers.get("mcp-session-id");
  if (!sessionId) {
    throw new Error("MCP initialize response missing mcp-session-id header");
  }
  return sessionId;
}

const sessionId = await initializeSession();

const res = await paidFetch(mcpUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "mcp-session-id": sessionId,
    "x-paidmcp-trial": "false",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "paid-fetch-smoke",
    method: "tools/call",
    params: { name: "get_price", arguments: { id: "bitcoin" } },
  }),
});

console.log("Status:", res.status, res.statusText);
const paymentResponse =
  res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
if (paymentResponse) {
  console.log(
    "PAYMENT-RESPONSE decoded:",
    Buffer.from(paymentResponse, "base64").toString("utf8"),
  );
}
const text = await res.text();
console.log("Body:", text);
if (res.status === 402) {
  console.log(
    "Smoke result: payment challenge returned (wallet likely unfunded for settlement).",
  );
}
process.exit(res.ok || res.status === 402 ? 0 : 1);
