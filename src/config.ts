import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const UserConfigSchema = z.object({
  seedPhrase: z.string().min(20),
  baseRpcUrl: z.string().url(),
  plasmaRpcUrl: z.string().url(),
  usdcAddress: evmAddress,
  usdt0Address: evmAddress
});

export type UserConfig = z.infer<typeof UserConfigSchema>;

export const BASE_NETWORK = "eip155:8453" as const;
export const PLASMA_NETWORK = "eip155:9745" as const;

export function getConfigPath(): string {
  return join(homedir(), ".paidmcp", "config.json");
}

export function loadConfig(): UserConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    throw new Error(`Missing config file at ${path}. Run "paidmcp init" first.`);
  }
  return UserConfigSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
}
