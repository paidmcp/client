import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { generateMnemonic } from "bip39";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CONFIG = {
  rpcUrl: "https://rpc.plasma.to",
  networkId: "eip155:9745",
  usdt0Address: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb"
};

export async function init(): Promise<void> {
  const configDir = join(homedir(), ".paidmcp");
  const configPath = join(configDir, "config.json");

  if (existsSync(configPath)) {
    throw new Error(`Config already exists at ${configPath}`);
  }

  const seedPhrase = generateMnemonic(128);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        seedPhrase,
        ...DEFAULT_CONFIG
      },
      null,
      2
    ),
    { mode: 0o600 }
  );

  const account = await new WalletManagerEvm(seedPhrase, { provider: DEFAULT_CONFIG.rpcUrl }).getAccount();
  console.log("Wallet created.");
  console.log("Address:", await account.getAddress());
  console.log("Config:", configPath);
  console.log("Fund this address with USDT0 on Plasma to use paid MCPs.");
}
