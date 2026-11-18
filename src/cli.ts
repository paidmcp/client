#!/usr/bin/env node
import { Command } from "commander";
import { printConnectSnippet } from "./connect.js";
import { runDoctor } from "./doctor.js";
import { init } from "./init.js";
import { importWallet } from "./init.js";
import { runProxy } from "./run.js";
import { version } from "./version.js";
import { showWallet } from "./wallet.js";

const program = new Command();
program
  .name("paidmcp")
  .description("Local proxy for paid MCP servers")
  .version(version);

program
  .command("init")
  .option("--force", "Overwrite existing config (requires --confirm)")
  .option("--confirm <text>", "Explicit confirmation text for overwrite")
  .description("Generate wallet and local config")
  .action(async (options) => init(Boolean(options.force), options.confirm));
program
  .command("wallet")
  .description("Show wallet information")
  .action(async () => showWallet());
program
  .command("wallet:import [seedPhrase]")
  .option("--force", "Overwrite existing config (requires --confirm)")
  .option("--confirm <text>", "Explicit confirmation text for overwrite")
  .description(
    "Import an existing seed phrase (read from stdin when not given, which keeps it out of shell history)",
  )
  .action(async (seedPhrase: string | undefined, options) => {
    if (seedPhrase) {
      console.error(
        "Warning: a seed phrase passed as an argument can end up in shell history and process lists. Prefer: paidmcp wallet:import < seed.txt",
      );
    }
    const phrase = seedPhrase ?? (await readSeedFromStdin());
    await importWallet(phrase, Boolean(options.force), options.confirm);
  });
program
  .command("connect <endpoint>")
  .description("Print MCP client config snippet")
  .action((endpoint) => {
    printConnectSnippet(endpoint);
  });
program
  .command("run <endpoint>")
  .description("Run stdio MCP proxy")
  .action(async (endpoint) => {
    await runProxy(endpoint);
  });
program
  .command("doctor [endpoint]")
  .description("Run local health checks")
  .action(async (endpoint) => runDoctor(endpoint));

await program.parseAsync();

async function readSeedFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    console.error("Enter your seed phrase, then press Enter and Ctrl-D:");
  }
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}
