console.log("=== paid fetch test (viem signer) ===");
const { readFileSync } = await import("node:fs");
const { homedir } = await import("node:os");
const { join } = await import("node:path");
const { mnemonicToAccount } = await import("viem/accounts");
const { ExactEvmScheme } = await import("@x402/evm");
const { x402Client, wrapFetchWithPayment } = await import("@x402/fetch");
const WalletManagerEvm = (await import("@tetherto/wdk-wallet-evm")).default;

const BASE = "eip155:8453";
const PLASMA = "eip155:9745";
const url = process.argv[2] ?? "http://localhost:4021/tools/get_price";
const signerType = process.argv[3] ?? "wdk";

const cfg = JSON.parse(readFileSync(join(homedir(), ".paidmcp", "config.json"), "utf-8"));
const baseAccount = await new WalletManagerEvm(cfg.seedPhrase, { provider: cfg.baseRpcUrl }).getAccount();
const plasmaAccount = await new WalletManagerEvm(cfg.seedPhrase, { provider: cfg.plasmaRpcUrl }).getAccount();

const balanceByNetwork = new Map();
await Promise.all([
  baseAccount.getTokenBalance(cfg.usdcAddress).then((b) => balanceByNetwork.set(BASE, b)),
  plasmaAccount.getTokenBalance(cfg.usdt0Address).then((b) => balanceByNetwork.set(PLASMA, b)).catch(() => null)
]);
console.log("Payer:", baseAccount.address);
console.log("Base USDC:", balanceByNetwork.get(BASE)?.toString());

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
    signTypedData: (message) => account.signTypedData(message)
  };
  console.log("Signer: viem");
} else {
  signer = {
    address: baseAccount.address,
    signTypedData: (message) => baseAccount.signTypedData(message)
  };
  console.log("Signer: wdk");
}

const client = new x402Client(selectRequirements)
  .register(BASE, new ExactEvmScheme(signer))
  .register(PLASMA, new ExactEvmScheme(signer));
const paidFetch = wrapFetchWithPayment(fetch, client);

const res = await paidFetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "bitcoin" })
});

console.log("Status:", res.status, res.statusText);
const paymentResponse = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
if (paymentResponse) {
  console.log("PAYMENT-RESPONSE decoded:", Buffer.from(paymentResponse, "base64").toString("utf8"));
}
const text = await res.text();
console.log("Body:", text);
process.exit(res.ok ? 0 : 1);
