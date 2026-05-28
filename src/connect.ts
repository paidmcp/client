export function printConnectSnippet(endpoint: string): void {
  const host = new URL(endpoint).hostname.replace(/\./g, "-");
  const snippet = {
    mcpServers: {
      [host]: {
        command: "paidmcp",
        args: ["run", endpoint]
      }
    }
  };

  console.log("Add this to your Claude Desktop MCP config:");
  console.log(JSON.stringify(snippet, null, 2));
}
