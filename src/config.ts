import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MODE_DEFAULTS, PLASMA_DEFAULTS } from "./policy.js";

export {
  BASE_NETWORK_MAINNET,
  BASE_NETWORK_TESTNET,
  PLASMA_NETWORK,
} from "./policy.js";

const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const UserConfigSchema = z.object({
  seedPhrase: z.string().min(20),
  networkMode: z.enum(["test", "live"]).default("test"),
  // Optional overrides; omitted values use the defaults for networkMode.
  baseRpcUrl: z.string().url().optional(),
  plasmaRpcUrl: z.string().url().optional(),
  usdcAddress: evmAddress.optional(),
  usdt0Address: evmAddress.optional(),
  maxPerCallUsdt: z.number().positive().default(0.25),
  maxSessionUsdt: z.number().positive().default(5),
  maxDailyUsdt: z.number().positive().default(10),
  confirmAboveUsdt: z.number().nonnegative().default(0.05),
});

export type UserConfig = Omit<
  z.infer<typeof UserConfigSchema>,
  "baseRpcUrl" | "plasmaRpcUrl" | "usdcAddress" | "usdt0Address"
> & {
  baseRpcUrl: string;
  plasmaRpcUrl: string;
  usdcAddress: string;
  usdt0Address: string;
  warnings: string[];
};

export function getConfigDir(): string {
  return join(homedir(), ".paidmcp");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function getLedgerPath(): string {
  return join(getConfigDir(), "spend-ledger.json");
}

export function loadConfig(): UserConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    throw new Error(
      `Missing config file at ${path}. Run "paidmcp init" first.`,
    );
  }
  const parsed = UserConfigSchema.parse(
    JSON.parse(readFileSync(path, "utf-8")),
  );
  const mode = MODE_DEFAULTS[parsed.networkMode];
  const otherMode =
    MODE_DEFAULTS[parsed.networkMode === "test" ? "live" : "test"];
  // Older versions wrote the test-mode defaults into the config, so treat
  // the other mode's default as "unset" when the mode is switched.
  const usdcAddress =
    parsed.usdcAddress &&
    parsed.usdcAddress.toLowerCase() !== otherMode.usdcAddress.toLowerCase()
      ? parsed.usdcAddress
      : mode.usdcAddress;
  const warnings: string[] = [];
  if (usdcAddress.toLowerCase() !== mode.usdcAddress.toLowerCase()) {
    warnings.push(
      `usdcAddress ${usdcAddress} is not the ${parsed.networkMode === "test" ? "Base Sepolia" : "Base mainnet"} USDC contract (${mode.usdcAddress}). Payments in USDC will be refused; remove usdcAddress from the config to use the default.`,
    );
  }
  const baseRpcUrl =
    parsed.baseRpcUrl && parsed.baseRpcUrl !== otherMode.baseRpcUrl
      ? parsed.baseRpcUrl
      : mode.baseRpcUrl;
  return {
    ...parsed,
    baseRpcUrl,
    plasmaRpcUrl: parsed.plasmaRpcUrl ?? PLASMA_DEFAULTS.rpcUrl,
    usdcAddress,
    usdt0Address: parsed.usdt0Address ?? PLASMA_DEFAULTS.usdt0Address,
    warnings,
  };
}
