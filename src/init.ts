import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { generateMnemonic } from "bip39";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CONFIG = {
  baseRpcUrl: "https://mainnet.base.org",
  plasmaRpcUrl: "https://rpc.plasma.to",
  usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  usdt0Address: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb"
};

export async function init(): Promise<void> {
  const configDir = join(homedir(), ".paidmcp");
  const configPath = join(configDir, "config.json");

  if (existsSync(configPath)) {
    throw new Error(`Config already exists at ${configPath}`);
  }

  const seedPhrase = generateMnemonic(128);
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(configPath, JSON.stringify({ seedPhrase, ...DEFAULT_CONFIG }, null, 2), { mode: 0o600 });

  const account = await new WalletManagerEvm(seedPhrase, { provider: DEFAULT_CONFIG.baseRpcUrl }).getAccount();
  console.log("Wallet created.");
  console.log("Address:", account.address);
  console.log("Config:", configPath);
  console.log("Security: this config file contains your seed phrase in plaintext. Do not commit or share it.");
  console.log("Backup: save the seed phrase securely. Losing it means losing access to funds.");
  console.log("Fund this address with USDC on Base or USDT0 on Plasma to use paid MCPs.");
}
