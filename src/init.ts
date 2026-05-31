import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { generateMnemonic } from "bip39";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CONFIG = {
  networkMode: "test" as const,
  baseRpcUrl: "https://sepolia.base.org",
  plasmaRpcUrl: "https://rpc.plasma.to",
  usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  usdt0Address: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
  maxPerCallUsdt: 0.25,
  maxSessionUsdt: 5,
  confirmAboveUsdt: 0.05,
};

const OVERWRITE_CONFIRMATION = "OVERWRITE_PAIDMCP_CONFIG";

type SaveConfigOptions = {
  force: boolean;
  confirm?: string;
  command: "init" | "wallet:import";
};

export async function init(force = false, confirm?: string): Promise<void> {
  const seedPhrase = generateMnemonic(128);
  await saveConfig(seedPhrase, { force, confirm, command: "init" });
}

export async function importWallet(
  seedPhrase: string,
  force = false,
  confirm?: string,
): Promise<void> {
  await saveConfig(seedPhrase, { force, confirm, command: "wallet:import" });
}

async function saveConfig(
  seedPhrase: string,
  options: SaveConfigOptions,
): Promise<void> {
  const configDir = join(homedir(), ".paidmcp");
  const configPath = join(configDir, "config.json");

  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const hasExistingConfig = existsSync(configPath);

  if (hasExistingConfig && !options.force) {
    throw new Error(
      `Config already exists at ${configPath}. Re-run ${options.command} with --force --confirm ${OVERWRITE_CONFIRMATION} to overwrite.`,
    );
  }

  if (hasExistingConfig) {
    if (options.confirm !== OVERWRITE_CONFIRMATION) {
      throw new Error(
        `Refusing overwrite without explicit confirmation. Re-run with --confirm ${OVERWRITE_CONFIRMATION}.`,
      );
    }
    const backupPath = createTimestampedBackup(configPath, configDir);
    console.log("Existing config backup:", backupPath);
  }

  writeFileSync(
    configPath,
    JSON.stringify({ seedPhrase, ...DEFAULT_CONFIG }, null, 2),
    { mode: 0o600 },
  );

  const account = await new WalletManagerEvm(seedPhrase, {
    provider: DEFAULT_CONFIG.baseRpcUrl,
  }).getAccount();
  console.log("Wallet created.");
  console.log("Address:", account.address);
  console.log("Config:", configPath);
  console.log(
    `Network mode: ${DEFAULT_CONFIG.networkMode} (Base Sepolia defaults)`,
  );
  console.log(
    "Security: this config file contains your seed phrase in plaintext. Do not commit or share it.",
  );
  console.log(
    "Backup: save the seed phrase securely. Losing it means losing access to funds.",
  );
  console.log(
    "You can test with Base Sepolia USDC first, then switch to live settings later.",
  );
}

function createTimestampedBackup(
  configPath: string,
  configDir: string,
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let backupPath = join(configDir, `config.backup-${timestamp}.json`);
  let counter = 1;
  while (existsSync(backupPath)) {
    backupPath = join(configDir, `config.backup-${timestamp}-${counter}.json`);
    counter += 1;
  }
  copyFileSync(configPath, backupPath);
  return backupPath;
}
