import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mnemonicToAccount } from "viem/accounts";
import { ExactEvmScheme } from "@x402/evm";
import { x402Client, x402HTTPClient } from "@x402/fetch";

const cfg = JSON.parse(readFileSync(join(homedir(), ".paidmcp", "config.json"), "utf-8"));
const account = mnemonicToAccount(cfg.seedPhrase);
const signer = { address: account.address, signTypedData: (m) => account.signTypedData(m) };
const client = new x402Client((_v, r) => r[0]).register("eip155:8453", new ExactEvmScheme(signer));
const http = new x402HTTPClient(client);

const url = "http://localhost:4021/tools/get_price";
const first = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "bitcoin" })
});
const pr = http.getPaymentRequiredResponse((n) => first.headers.get(n), {});
const payload = await client.createPaymentPayload(pr);
const req = payload.accepted;

const facilitators = [
  ["Heurist", "https://facilitator.heurist.xyz"],
  ["Semantic", "https://x402.semanticpay.io"],
  ["CDP", "https://api.cdp.coinbase.com/platform/v2/x402"],
  ["x402.org", "https://x402.org/facilitator"]
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
          paymentRequirements: req
        })
      });
      const text = await res.text();
      console.log(`\n${name} ${path} -> ${res.status}`);
      console.log(text.slice(0, 300));
    } catch (e) {
      console.log(`\n${name} ${path} -> ERROR`, e.message);
    }
  }
}
