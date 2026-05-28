import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { loadConfig } from "./config.js";

export async function runProxy(endpoint: string): Promise<void> {
  const cfg = loadConfig();
  const baseUrl = endpoint.replace(/\/+$/, "");
  const networkId = cfg.networkId as `${string}:${string}`;
  const account = await new WalletManagerEvm(cfg.seedPhrase, { provider: cfg.rpcUrl }).getAccount();
  const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: networkId,
        client: new ExactEvmScheme(account as any)
      }
    ]
  });

  const mcp = new Server(
    { name: `paidmcp-proxy:${new URL(baseUrl).hostname}`, version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => {
    const response = await fetch(`${baseUrl}/mcp/tools`);
    if (!response.ok) {
      throw new Error(`Failed to load tools: ${response.status}`);
    }
    return response.json();
  });

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const response = await paidFetch(`${baseUrl}/tools/${request.params.name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.params.arguments ?? {})
    });

    if (!response.ok) {
      const text = await response.text();
      return { isError: true, content: [{ type: "text", text }] };
    }

    const data = await response.json();
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  });

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}
