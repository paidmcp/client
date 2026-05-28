import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { loadConfig } from "./config.js";

export async function showWallet(): Promise<void> {
  const cfg = loadConfig();
  const account = await new WalletManagerEvm(cfg.seedPhrase, { provider: cfg.rpcUrl }).getAccount();
  const address = await account.getAddress();
  console.log("Address:", address);
  console.log("Network:", cfg.networkId);
  console.log("USDT0 contract:", cfg.usdt0Address);
}
