import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const UserConfigSchema = z.object({
  seedPhrase: z.string().min(20),
  networkMode: z.enum(["test", "live"]).default("test"),
  baseRpcUrl: z.string().url(),
  plasmaRpcUrl: z.string().url(),
  usdcAddress: evmAddress,
  usdt0Address: evmAddress,
  maxPerCallUsdt: z.number().positive().default(0.25),
  maxSessionUsdt: z.number().positive().default(5),
  confirmAboveUsdt: z.number().nonnegative().default(0.05),
});

export type UserConfig = z.infer<typeof UserConfigSchema>;

export const BASE_NETWORK_TESTNET = "eip155:84532" as const;
export const BASE_NETWORK_MAINNET = "eip155:8453" as const;
export const PLASMA_NETWORK = "eip155:9745" as const;

export function getConfigPath(): string {
  return join(homedir(), ".paidmcp", "config.json");
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
  return parsed;
}
