import { loadConfig } from "./config.js";

export async function runDoctor(endpoint?: string): Promise<void> {
  const cfg = loadConfig();
  console.log("paidmcp doctor");
  console.log("- config loaded:", cfg.networkMode, "mode");
  console.log("- base rpc:", cfg.baseRpcUrl);
  console.log("- plasma rpc:", cfg.plasmaRpcUrl);
  if (!endpoint) {
    console.log('- endpoint check skipped (pass "paidmcp doctor <endpoint>")');
    return;
  }
  const health = await fetch(`${endpoint.replace(/\/+$/, "")}/mcp/tools`).catch(
    () => null,
  );
  if (!health) {
    console.log("- endpoint:", endpoint, "(unreachable)");
    return;
  }
  console.log(`- endpoint: ${endpoint} (${health.status})`);
}
