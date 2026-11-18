import { loadConfig } from "./config.js";
import { normalizeEndpoint } from "./policy.js";
import { version } from "./version.js";

export async function runDoctor(endpoint?: string): Promise<void> {
  const cfg = loadConfig();
  console.log("paidmcp doctor");
  console.log("- config loaded:", cfg.networkMode, "mode");
  console.log("- base rpc:", cfg.baseRpcUrl);
  if (cfg.networkMode === "live") {
    console.log("- plasma rpc:", cfg.plasmaRpcUrl);
  }
  console.log(
    `- caps (USD): per call ${cfg.maxPerCallUsdt}, per session ${cfg.maxSessionUsdt}, per day ${cfg.maxDailyUsdt}; confirm at ${cfg.confirmAboveUsdt}+`,
  );
  for (const warning of cfg.warnings) console.log("- warning:", warning);
  if (!endpoint) {
    console.log('- endpoint check skipped (pass "paidmcp doctor <endpoint>")');
    return;
  }

  let baseUrl: string;
  try {
    baseUrl = normalizeEndpoint(endpoint);
  } catch (error) {
    console.log("- endpoint:", (error as Error).message);
    return;
  }
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "paidmcp-doctor", version },
      },
    }),
  }).catch((error: unknown) => error as Error);
  if (response instanceof Error) {
    console.log(`- endpoint: ${baseUrl}/mcp unreachable (${response.message})`);
    return;
  }
  const text = await response.text();
  const serverName = /"serverInfo"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/.exec(
    text,
  )?.[1];
  if (response.ok && serverName) {
    console.log(`- endpoint: ${baseUrl}/mcp OK (MCP server "${serverName}")`);
  } else {
    console.log(
      `- endpoint: ${baseUrl}/mcp did not answer MCP initialize (HTTP ${response.status})`,
    );
  }
}
