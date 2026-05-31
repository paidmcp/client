function serverNameFromEndpoint(endpoint: string): string {
  const host = new URL(endpoint).hostname.toLowerCase();
  return host.replace(/[^a-z0-9-]/g, "-") || "paid-mcp";
}

export function printConnectSnippet(endpoint: string): void {
  const name = serverNameFromEndpoint(endpoint);
  const snippet = {
    mcpServers: {
      [name]: {
        command: "npx",
        args: ["paidmcp-client", "run", endpoint],
      },
    },
  };

  console.log("Add this to your Cursor or Claude Desktop MCP config:");
  console.log(JSON.stringify(snippet, null, 2));
}
