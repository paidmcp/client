import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { type ClientEvmSigner, ExactEvmScheme } from "@x402/evm";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import type { PaymentRequirements } from "@x402/fetch";
import {
  BASE_NETWORK_MAINNET,
  BASE_NETWORK_TESTNET,
  PLASMA_NETWORK,
  loadConfig,
} from "./config.js";
import { version } from "./version.js";

export async function runProxy(endpoint: string): Promise<void> {
  const cfg = loadConfig();
  const baseUrl = endpoint.replace(/\/+$/, "");
  const baseNetwork =
    cfg.networkMode === "test" ? BASE_NETWORK_TESTNET : BASE_NETWORK_MAINNET;
  const maxPerCallAtomic = toAtomic(cfg.maxPerCallUsdt);
  const maxSessionAtomic = toAtomic(cfg.maxSessionUsdt);
  const confirmAboveAtomic = toAtomic(cfg.confirmAboveUsdt);
  let sessionSpentAtomic = 0n;

  const baseAccount = await new WalletManagerEvm(cfg.seedPhrase, {
    provider: cfg.baseRpcUrl,
  }).getAccount();
  const plasmaAccount = await new WalletManagerEvm(cfg.seedPhrase, {
    provider: cfg.plasmaRpcUrl,
  }).getAccount();

  const signer: ClientEvmSigner = {
    address: baseAccount.address as `0x${string}`,
    signTypedData: (message) =>
      baseAccount.signTypedData(
        message as Parameters<typeof baseAccount.signTypedData>[0],
      ) as Promise<`0x${string}`>,
  };

  const balanceByNetwork = new Map<string, bigint>();
  await refreshBalances();

  const selectRequirements = (
    _version: number,
    requirements: PaymentRequirements[],
  ): PaymentRequirements => {
    const affordable = requirements
      .filter((r) => BigInt(r.amount) <= maxPerCallAtomic)
      .sort((a, b) => Number(BigInt(a.amount) - BigInt(b.amount)))
      .find((r) => {
        const balance = balanceByNetwork.get(r.network);
        return balance !== undefined && balance >= BigInt(r.amount);
      });
    if (!affordable) {
      throw new Error(
        "No affordable payment requirement matched your balance and spend limits.",
      );
    }
    return affordable;
  };

  const paymentClient = new x402Client(selectRequirements)
    .register(baseNetwork, new ExactEvmScheme(signer))
    .register(PLASMA_NETWORK, new ExactEvmScheme(signer));

  const withHooks = paymentClient as unknown as {
    onBeforePaymentCreation?: (
      fn: (ctx: {
        selectedRequirements: PaymentRequirements;
      }) => Promise<{ abort?: boolean; reason?: string } | undefined>,
    ) => unknown;
    onAfterPaymentCreation?: (
      fn: (ctx: { selectedRequirements: PaymentRequirements }) => Promise<void>,
    ) => unknown;
  };
  withHooks.onBeforePaymentCreation?.(async (ctx) => {
    const amount = BigInt(ctx.selectedRequirements.amount);
    if (amount > maxPerCallAtomic) {
      return { abort: true, reason: "Per-call cap exceeded" };
    }
    if (sessionSpentAtomic + amount > maxSessionAtomic) {
      return { abort: true, reason: "Session cap exceeded" };
    }
    if (amount >= confirmAboveAtomic) {
      const ok = await confirmPayment(
        toUnits(amount),
        ctx.selectedRequirements.network,
      );
      if (!ok) {
        return { abort: true, reason: "User rejected payment" };
      }
    }
  });
  withHooks.onAfterPaymentCreation?.(async (ctx) => {
    const amount = BigInt(ctx.selectedRequirements.amount);
    sessionSpentAtomic += amount;
    console.error(
      `[paidmcp] paid ${toUnits(amount)} on ${ctx.selectedRequirements.network}; session total ${toUnits(sessionSpentAtomic)}`,
    );
  });

  const paidFetch = wrapFetchWithPayment(fetch, paymentClient);

  const upstream = new Client(
    { name: `paidmcp-upstream:${new URL(baseUrl).hostname}`, version },
    { capabilities: {} },
  );
  const upstreamTransport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    {
      fetch: paidFetch,
    },
  );
  await upstream.connect(upstreamTransport);

  const mcp = new Server(
    { name: `paidmcp-proxy:${new URL(baseUrl).hostname}`, version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return upstream.listTools(request.params);
  });

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    await refreshBalances();
    return upstream.callTool(request.params);
  });

  mcp.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    return upstream.listResources(request.params);
  });

  mcp.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return upstream.readResource(request.params);
  });

  mcp.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    return upstream.listPrompts(request.params);
  });

  mcp.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return upstream.getPrompt(request.params);
  });

  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  async function refreshBalances(): Promise<void> {
    const [base, plasma] = await Promise.all([
      baseAccount.getTokenBalance(cfg.usdcAddress).catch(() => null),
      plasmaAccount.getTokenBalance(cfg.usdt0Address).catch(() => null),
    ]);
    if (base !== null) balanceByNetwork.set(baseNetwork, base);
    if (plasma !== null) balanceByNetwork.set(PLASMA_NETWORK, plasma);
  }
}

function toAtomic(value: number): bigint {
  return BigInt(Math.round(value * 1_000_000));
}

function toUnits(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

async function confirmPayment(
  amountUsdt: string,
  network: string,
): Promise<boolean> {
  if (!stdin.isTTY) {
    console.error(
      `[paidmcp] non-interactive session: auto-approving ${amountUsdt} USDT on ${network}`,
    );
    return true;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      `Confirm payment ${amountUsdt} USDT on ${network}? Type "yes" to approve: `,
    );
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}
