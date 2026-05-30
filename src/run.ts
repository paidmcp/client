import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { ClientEvmSigner, ExactEvmScheme } from "@x402/evm";
import { x402Client } from "@x402/fetch";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { PaymentRequirements } from "@x402/fetch";
import { BASE_NETWORK, PLASMA_NETWORK, loadConfig } from "./config.js";

export async function runProxy(endpoint: string): Promise<void> {
  const cfg = loadConfig();
  const baseUrl = endpoint.replace(/\/+$/, "");

  // Same key on both chains; provider differs only for balance reads.
  const baseAccount = await new WalletManagerEvm(cfg.seedPhrase, {
    provider: cfg.baseRpcUrl,
  }).getAccount();
  const plasmaAccount = await new WalletManagerEvm(cfg.seedPhrase, {
    provider: cfg.plasmaRpcUrl,
  }).getAccount();

  // WDK account -> x402 ClientEvmSigner. Signing is key-based (domain comes from the
  // requirement), so the base account signs valid payments for either chain.
  const signer: ClientEvmSigner = {
    address: baseAccount.address as `0x${string}`,
    // x402 passes EIP-712 typed data; WDK's ethers-based signer derives primaryType
    // from `types`. The shapes match at runtime; the cast bridges stricter ethers types.
    signTypedData: (message) =>
      baseAccount.signTypedData(
        message as Parameters<typeof baseAccount.signTypedData>[0],
      ) as Promise<`0x${string}`>,
  };

  // Prefetch balances once so the (synchronous) selector can prefer a funded chain.
  const balanceByNetwork = new Map<string, bigint>();
  await Promise.all([
    baseAccount
      .getTokenBalance(cfg.usdcAddress)
      .then((b) => balanceByNetwork.set(BASE_NETWORK, b))
      .catch(() => undefined),
    plasmaAccount
      .getTokenBalance(cfg.usdt0Address)
      .then((b) => balanceByNetwork.set(PLASMA_NETWORK, b))
      .catch(() => undefined),
  ]);

  const selectRequirements = (
    _version: number,
    requirements: PaymentRequirements[],
  ): PaymentRequirements => {
    const affordable = requirements.find((r) => {
      const balance = balanceByNetwork.get(r.network);
      return balance !== undefined && balance >= BigInt(r.amount);
    });
    return affordable ?? requirements[0];
  };

  const client = new x402Client(selectRequirements)
    .register(BASE_NETWORK, new ExactEvmScheme(signer))
    .register(PLASMA_NETWORK, new ExactEvmScheme(signer));
  const paidFetch = wrapFetchWithPayment(fetch, client);

  const mcp = new Server(
    { name: `paidmcp-proxy:${new URL(baseUrl).hostname}`, version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => {
    const response = await fetch(`${baseUrl}/mcp/tools`);
    if (!response.ok) {
      throw new Error(`Failed to load tools: ${response.status}`);
    }
    return response.json();
  });

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const response = await paidFetch(
      `${baseUrl}/tools/${request.params.name}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.params.arguments ?? {}),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      const paymentResponseHeader =
        response.headers.get("payment-response") ??
        response.headers.get("x-payment-response");
      let detail = text;
      if (paymentResponseHeader) {
        try {
          const decoded = JSON.parse(
            Buffer.from(paymentResponseHeader, "base64").toString("utf8"),
          );
          detail = JSON.stringify(decoded, null, 2);
        } catch {
          detail = paymentResponseHeader;
        }
      } else if (!text || text === "{}") {
        detail = `HTTP ${response.status} ${response.statusText} (no error body; payment likely failed at settlement)`;
      }
      return { isError: true, content: [{ type: "text", text: detail }] };
    }

    const data = await response.json();
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  });

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}
