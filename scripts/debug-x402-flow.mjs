/**
 * Full x402 flow with debug: 402 -> sign -> paid retry -> decode all headers.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mnemonicToAccount } from "viem/accounts";
import { ExactEvmScheme } from "@x402/evm";
import { x402Client, x402HTTPClient, wrapFetchWithPayment } from "@x402/fetch";

const BASE = "eip155:8453";
const PLASMA = "eip155:9745";
const url = process.argv[2] ?? "http://localhost:4021/tools/get_price";

const cfg = JSON.parse(readFileSync(join(homedir(), ".paidmcp", "config.json"), "utf-8"));
const account = mnemonicToAccount(cfg.seedPhrase);
const signer = {
  address: account.address,
  signTypedData: (m) => account.signTypedData(m)
};

const balanceByNetwork = new Map([[BASE, 1_000_000n], [PLASMA, 0n]]);
const selectRequirements = (_v, reqs) => {
  const picked = reqs.find((r) => balanceByNetwork.get(r.network) >= BigInt(r.amount)) ?? reqs[0];
  console.log("Selected:", picked.network, picked.amount, picked.asset);
  return picked;
};

const client = new x402Client(selectRequirements)
  .register(BASE, new ExactEvmScheme(signer))
  .register(PLASMA, new ExactEvmScheme(signer));
const httpClient = new x402HTTPClient(client);

// Step 1: unpaid request
const first = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "bitcoin" })
});
console.log("\n=== STEP 1: unpaid ===");
console.log("status:", first.status);
const getHeader = (n) => first.headers.get(n);
const paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, first.status === 402 ? {} : undefined);
console.log("resource.url:", paymentRequired.resource?.url);
console.log("accepts:", JSON.stringify(paymentRequired.accepts, null, 2));

// Step 2: create payment payload
const paymentPayload = await client.createPaymentPayload(paymentRequired);
console.log("\n=== STEP 2: signed payload ===");
console.log(JSON.stringify(paymentPayload, null, 2));

// Step 3: verify via Heurist directly
const requirements = paymentPayload.accepted;
const verifyRes = await fetch("https://facilitator.heurist.xyz/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    x402Version: paymentPayload.x402Version,
    paymentPayload,
    paymentRequirements: requirements
  })
});
const verifyBody = await verifyRes.json();
console.log("\n=== STEP 3: Heurist /verify ===");
console.log("status:", verifyRes.status);
console.log(JSON.stringify(verifyBody, null, 2));

// Step 4: paid retry to local server
const payHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
const paid = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...payHeaders },
  body: JSON.stringify({ id: "bitcoin" })
});
console.log("\n=== STEP 4: paid request to server ===");
console.log("status:", paid.status);
const pr = paid.headers.get("payment-response");
if (pr) console.log("PAYMENT-RESPONSE:", Buffer.from(pr, "base64").toString("utf8"));
console.log("body:", await paid.text());

// Step 5: Heurist settle directly (only if verify passed)
if (verifyBody.isValid) {
  const settleRes = await fetch("https://facilitator.heurist.xyz/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      x402Version: paymentPayload.x402Version,
      paymentPayload,
      paymentRequirements: requirements
    })
  });
  const settleBody = await settleRes.json();
  console.log("\n=== STEP 5: Heurist /settle (direct) ===");
  console.log("status:", settleRes.status);
  console.log(JSON.stringify(settleBody, null, 2));
}
