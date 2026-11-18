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
import { getLedgerPath, loadConfig } from "./config.js";
import { SpendLedger } from "./ledger.js";
import {
  MODE_DEFAULTS,
  PLASMA_NETWORK,
  acceptedAssets,
  findAcceptedAsset,
  formatUsd,
  normalizeEndpoint,
  selectRequirement,
  toAtomic,
} from "./policy.js";
import { version } from "./version.js";

// stdout carries the MCP protocol: every log line must go to stderr.
const log = (message: string) => console.error(`[paidmcp] ${message}`);

export async function runProxy(endpoint: string): Promise<void> {
  const cfg = loadConfig();
  cfg.warnings.forEach((w) => log(`warning: ${w}`));
  const baseUrl = normalizeEndpoint(endpoint);
  const host = new URL(baseUrl).host;
  const isLive = cfg.networkMode === "live";
  const baseNetwork = MODE_DEFAULTS[cfg.networkMode].baseNetwork;
  const accepted = acceptedAssets(cfg);

  const maxPerCallAtomic = toAtomic(cfg.maxPerCallUsdt);
  const maxSessionAtomic = toAtomic(cfg.maxSessionUsdt);
  const maxDailyAtomic = toAtomic(cfg.maxDailyUsdt);
  const confirmAboveAtomic = toAtomic(cfg.confirmAboveUsdt);
  const ledger = new SpendLedger(getLedgerPath());
  let sessionReservedAtomic = 0n;
  const reservations = new WeakMap<
    PaymentRequirements,
    { amount: bigint; day: string }
  >();

  const baseAccount = await new WalletManagerEvm(cfg.seedPhrase, {
    provider: cfg.baseRpcUrl,
  }).getAccount();
  const plasmaAccount = isLive
    ? await new WalletManagerEvm(cfg.seedPhrase, {
        provider: cfg.plasmaRpcUrl,
      }).getAccount()
    : null;

  const signer: ClientEvmSigner = {
    address: baseAccount.address as `0x${string}`,
    signTypedData: (message) =>
      baseAccount.signTypedData(
        message as Parameters<typeof baseAccount.signTypedData>[0],
      ) as Promise<`0x${string}`>,
  };

  const balanceByNetwork = new Map<string, bigint>();
  await refreshBalances();

  const mcp = new Server(
    { name: `paidmcp-proxy:${host}`, version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  const paymentClient = new x402Client((_version, requirements) =>
    selectRequirement(requirements, {
      accepted,
      maxPerCallAtomic,
      balances: balanceByNetwork,
    }),
  ).register(baseNetwork, new ExactEvmScheme(signer));
  if (isLive) {
    paymentClient.register(PLASMA_NETWORK, new ExactEvmScheme(signer));
  }

  paymentClient.onBeforePaymentCreation(async (ctx) => {
    const requirement = ctx.selectedRequirements;
    const amount = BigInt(requirement.amount);
    const asset = findAcceptedAsset(requirement, accepted);
    if (!asset) {
      return { abort: true, reason: "Unsupported payment token or network" };
    }
    if (amount > maxPerCallAtomic) {
      return {
        abort: true,
        reason: `${formatUsd(amount)} is above your per-call cap (maxPerCallUsdt)`,
      };
    }
    // Reserve before anything awaits, so parallel calls cannot overshoot.
    if (sessionReservedAtomic + amount > maxSessionAtomic) {
      return {
        abort: true,
        reason: `Session cap reached (maxSessionUsdt=${cfg.maxSessionUsdt}). Restart the MCP server to reset it.`,
      };
    }
    const day = ledger.reserve(amount, maxDailyAtomic);
    if (!day) {
      return {
        abort: true,
        reason: `Daily cap reached (maxDailyUsdt=${cfg.maxDailyUsdt}, UTC day).`,
      };
    }
    sessionReservedAtomic += amount;
    reservations.set(requirement, { amount, day });

    if (amount >= confirmAboveAtomic) {
      const decision = await confirmPayment(
        mcp,
        `Pay ${formatUsd(amount)} in ${asset.label} to ${host}?`,
        cfg.confirmAboveUsdt,
      );
      if (!decision.approved) {
        releaseReservation(requirement);
        return { abort: true, reason: decision.reason };
      }
    }
    return undefined;
  });
  paymentClient.onPaymentCreationFailure(async (ctx) => {
    releaseReservation(ctx.selectedRequirements);
    return undefined;
  });
  paymentClient.onAfterPaymentCreation(async (ctx) => {
    const amount = BigInt(ctx.selectedRequirements.amount);
    log(
      `signed payment of ${formatUsd(amount)} on ${ctx.selectedRequirements.network}; session total ${formatUsd(sessionReservedAtomic)}, today ${formatUsd(ledger.spentToday())}`,
    );
  });

  const paidFetch = wrapFetchWithPayment(fetch, paymentClient);

  const upstream = new Client(
    { name: `paidmcp-upstream:${host}`, version },
    { capabilities: {} },
  );
  await upstream.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      fetch: paidFetch,
    }),
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return upstream.listTools(request.params);
  });

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    await refreshBalances();
    try {
      return await upstream.callTool(request.params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`tool call failed: ${message}`);
      return { isError: true, content: [{ type: "text", text: message }] };
    }
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
  // Exit with the MCP client instead of lingering on the upstream stream.
  process.stdin.on("end", () => process.exit(0));
  await mcp.connect(transport);

  function releaseReservation(requirement: PaymentRequirements): void {
    const reservation = reservations.get(requirement);
    if (!reservation) return;
    reservations.delete(requirement);
    sessionReservedAtomic -= reservation.amount;
    ledger.release(reservation.amount, reservation.day);
  }

  async function refreshBalances(): Promise<void> {
    const [base, plasma] = await Promise.all([
      baseAccount.getTokenBalance(cfg.usdcAddress).catch(() => null),
      plasmaAccount
        ? plasmaAccount.getTokenBalance(cfg.usdt0Address).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (base !== null) balanceByNetwork.set(baseNetwork, base);
    if (plasma !== null) balanceByNetwork.set(PLASMA_NETWORK, plasma);
  }
}

/**
 * Asks the user through their MCP client (elicitation). Payments are never
 * approved silently: if the client cannot show prompts, the payment is
 * refused with instructions for raising the confirmation threshold.
 */
export async function confirmPayment(
  mcp: Pick<Server, "getClientCapabilities" | "elicitInput">,
  message: string,
  confirmAboveUsdt: number,
): Promise<{ approved: boolean; reason: string }> {
  if (!mcp.getClientCapabilities()?.elicitation) {
    return {
      approved: false,
      reason: `This payment needs your approval (it is at or above confirmAboveUsdt=${confirmAboveUsdt}), but this MCP client cannot show approval prompts. To allow payments of this size without a prompt, raise "confirmAboveUsdt" in ~/.paidmcp/config.json.`,
    };
  }
  try {
    const result = await mcp.elicitInput({
      message,
      requestedSchema: {
        type: "object",
        properties: {
          approve: {
            type: "boolean",
            title: "Approve this payment",
            default: false,
          },
        },
        required: ["approve"],
      },
    });
    const approved =
      result.action === "accept" && result.content?.approve === true;
    return { approved, reason: "Payment was not approved." };
  } catch (error) {
    return {
      approved: false,
      reason: `Could not get payment approval: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
