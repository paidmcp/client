import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const UserConfigSchema = z.object({
  seedPhrase: z.string().min(20),
  rpcUrl: z.string().url(),
  networkId: z.string().regex(/^eip155:\d+$/),
  usdt0Address: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
});

export type UserConfig = z.infer<typeof UserConfigSchema>;

export function getConfigPath(): string {
  return join(homedir(), ".paidmcp", "config.json");
}

export function loadConfig(): UserConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    throw new Error(`Missing config file at ${path}. Run "paidmcp init" first.`);
  }
  const raw = readFileSync(path, "utf-8");
  return UserConfigSchema.parse(JSON.parse(raw));
}
