import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { loadConfig } from "./config.js";

function formatUnits(value: bigint, decimals = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export async function showWallet(): Promise<void> {
  const cfg = loadConfig();
  console.log("Mode:", cfg.networkMode);

  const baseAccount = await new WalletManagerEvm(cfg.seedPhrase, {
    provider: cfg.baseRpcUrl,
  }).getAccount();
  const plasmaAccount = await new WalletManagerEvm(cfg.seedPhrase, {
    provider: cfg.plasmaRpcUrl,
  }).getAccount();

  console.log("Address:", baseAccount.address);

  const [usdc, usdt0] = await Promise.all([
    baseAccount.getTokenBalance(cfg.usdcAddress).catch(() => null),
    plasmaAccount.getTokenBalance(cfg.usdt0Address).catch(() => null),
  ]);

  console.log(
    `Base   USDC:  ${usdc === null ? "(unavailable)" : formatUnits(usdc)}`,
  );
  console.log(
    `Plasma USDT0: ${usdt0 === null ? "(unavailable)" : formatUnits(usdt0)}`,
  );
  console.log(
    `Spend caps: per-call=${cfg.maxPerCallUsdt} USDT, per-session=${cfg.maxSessionUsdt} USDT`,
  );
}
