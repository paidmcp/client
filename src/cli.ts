#!/usr/bin/env node
import { Command } from "commander";
import { printConnectSnippet } from "./connect.js";
import { init } from "./init.js";
import { runProxy } from "./run.js";
import { showWallet } from "./wallet.js";

const program = new Command();
program.name("paidmcp").description("Local proxy for paid MCP servers").version("0.1.0");

program.command("init").description("Generate wallet and local config").action(async () => init());
program.command("wallet").description("Show wallet information").action(async () => showWallet());
program.command("connect <endpoint>").description("Print MCP client config snippet").action((endpoint) => {
  printConnectSnippet(endpoint);
});
program.command("run <endpoint>").description("Run stdio MCP proxy").action(async (endpoint) => {
  await runProxy(endpoint);
});

program.parse();
