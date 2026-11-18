import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, test } from "node:test";
import { SpendLedger } from "../src/ledger.js";

const dir = mkdtempSync(join(tmpdir(), "paidmcp-ledger-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("SpendLedger", () => {
  test("reserves up to the cap, then refuses", () => {
    const ledger = new SpendLedger(join(dir, "a.json"));
    assert.ok(ledger.reserve(600n, 1000n));
    assert.equal(ledger.reserve(500n, 1000n), null);
    assert.ok(ledger.reserve(400n, 1000n));
    assert.equal(ledger.spentToday(), 1000n);
  });

  test("released amounts can be spent again", () => {
    const ledger = new SpendLedger(join(dir, "b.json"));
    const day = ledger.reserve(1000n, 1000n);
    assert.ok(day);
    ledger.release(1000n, day);
    assert.ok(ledger.reserve(1000n, 1000n));
  });

  test("totals persist across instances (i.e. restarts)", () => {
    const path = join(dir, "c.json");
    assert.ok(new SpendLedger(path).reserve(700n, 1000n));
    assert.equal(new SpendLedger(path).reserve(700n, 1000n), null);
  });

  test("each UTC day has its own total", () => {
    const ledger = new SpendLedger(join(dir, "d.json"));
    assert.ok(ledger.reserve(1000n, 1000n, new Date("2026-01-01T23:00:00Z")));
    assert.ok(ledger.reserve(1000n, 1000n, new Date("2026-01-02T01:00:00Z")));
  });

  test("a corrupt ledger fails closed instead of resetting to zero", () => {
    const path = join(dir, "e.json");
    writeFileSync(path, "{not json");
    assert.throws(() => new SpendLedger(path).reserve(1n, 1000n), /unreadable/);
  });

  test("concurrent processes cannot overshoot the cap", async () => {
    const path = join(dir, "f.json");
    const worker = join(dir, "worker.ts");
    const ledgerModule = resolve(import.meta.dirname, "../src/ledger.ts");
    writeFileSync(
      worker,
      `import { SpendLedger } from ${JSON.stringify(ledgerModule)};
const ledger = new SpendLedger(${JSON.stringify(path)});
let ok = 0;
for (let i = 0; i < 25; i++) if (ledger.reserve(10n, 1000n)) ok++;
console.log(ok);`,
    );
    // 8 processes x 25 attempts x 10 units = 2000 requested, cap 1000.
    const results = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          new Promise<number>((done, fail) => {
            const child = spawn(process.execPath, ["--import", "tsx", worker]);
            let out = "";
            child.stdout.on("data", (d) => (out += d));
            child.on("exit", (code) =>
              code === 0
                ? done(Number(out.trim()))
                : fail(new Error(`exit ${code}`)),
            );
          }),
      ),
    );
    const granted = results.reduce((a, b) => a + b, 0);
    assert.equal(granted, 100);
    assert.equal(new SpendLedger(path).spentToday(), 1000n);
  });
});
