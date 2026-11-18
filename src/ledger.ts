import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

type LedgerFile = { version: 1; days: Record<string, string> };

const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;
const KEEP_DAYS = 14;

/**
 * Daily spend totals shared by every paidmcp process on this machine
 * (one proxy runs per MCP server and per client window). Amounts are
 * reserved before a payment is signed, under a file lock, so parallel calls
 * and separate processes cannot overshoot the daily cap. Days are UTC.
 */
export class SpendLedger {
  constructor(private readonly path: string) {}

  /** Reserves `amount` for today if the total stays within `cap`. */
  reserve(amount: bigint, cap: bigint, now = new Date()): string | null {
    const day = dayKey(now);
    return this.withLock(() => {
      const ledger = this.read();
      const spent = BigInt(ledger.days[day] ?? "0");
      if (spent + amount > cap) return null;
      ledger.days[day] = (spent + amount).toString();
      this.write(ledger);
      return day;
    });
  }

  /** Gives back a reservation that was not used (e.g. the user declined). */
  release(amount: bigint, day: string): void {
    this.withLock(() => {
      const ledger = this.read();
      const spent = BigInt(ledger.days[day] ?? "0");
      ledger.days[day] = (spent > amount ? spent - amount : 0n).toString();
      this.write(ledger);
    });
  }

  spentToday(now = new Date()): bigint {
    return BigInt(this.read().days[dayKey(now)] ?? "0");
  }

  private read(): LedgerFile {
    if (!existsSync(this.path)) return { version: 1, days: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as LedgerFile;
      return { version: 1, days: parsed.days ?? {} };
    } catch {
      // A corrupt ledger must not silently reset spending to zero.
      throw new Error(
        `Spend ledger ${this.path} is unreadable. Fix or delete it to continue.`,
      );
    }
  }

  private write(ledger: LedgerFile): void {
    const days = Object.keys(ledger.days).sort().slice(-KEEP_DAYS);
    const pruned: LedgerFile = {
      version: 1,
      days: Object.fromEntries(days.map((d) => [d, ledger.days[d]])),
    };
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(pruned, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  private withLock<T>(fn: () => T): T {
    const lockPath = `${this.path}.lock`;
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    let fd: number | undefined;
    while (fd === undefined) {
      try {
        fd = openSync(lockPath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
            unlinkSync(lockPath);
            continue;
          }
        } catch {
          continue; // lock vanished between checks
        }
        if (Date.now() > deadline) {
          throw new Error(
            `Timed out waiting for spend ledger lock ${lockPath}`,
          );
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
    }
    try {
      return fn();
    } finally {
      closeSync(fd);
      try {
        unlinkSync(lockPath);
      } catch {
        // already removed
      }
    }
  }
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
