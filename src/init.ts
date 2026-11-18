import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { generateMnemonic, validateMnemonic } from "bip39";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MODE_DEFAULTS } from "./policy.js";

// RPC URLs and token addresses are left out on purpose: they default per
// networkMode, so switching to "live" needs no other edits.
const DEFAULT_CONFIG = {
  networkMode: "test" as const,
  maxPerCallUsdt: 0.25,
  maxSessionUsdt: 5,
  maxDailyUsdt: 10,
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
  seedPhrase = seedPhrase.trim().replace(/\s+/g, " ").toLowerCase();
  if (!validateMnemonic(seedPhrase)) {
    throw new Error(
      "That is not a valid BIP-39 seed phrase (check the words and their order). Nothing was changed.",
    );
  }
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

  // Keep the user's existing settings (mode, caps, overrides) on overwrite.
  const previous = hasExistingConfig ? readExistingSettings(configPath) : {};
  const settings = { ...DEFAULT_CONFIG, ...previous };
  writeFileSync(
    configPath,
    JSON.stringify({ seedPhrase, ...settings }, null, 2),
    {
      mode: 0o600,
    },
  );
  // `mode` only applies when the file is created; tighten existing files too.
  chmodSync(configPath, 0o600);
  chmodSync(configDir, 0o700);

  const account = await new WalletManagerEvm(seedPhrase, {
    provider: MODE_DEFAULTS.test.baseRpcUrl,
  }).getAccount();
  console.log("Wallet created.");
  console.log("Address:", account.address);
  console.log("Config:", configPath);
  console.log(
    `Network mode: ${settings.networkMode}${settings.networkMode === "test" ? " (Base Sepolia)" : ""}`,
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

function readExistingSettings(configPath: string): Record<string, unknown> {
  try {
    const existing = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    delete existing.seedPhrase;
    return existing;
  } catch {
    return {};
  }
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
  chmodSync(backupPath, 0o600);
  return backupPath;
}
