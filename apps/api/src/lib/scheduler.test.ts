import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JOBS, MINUTE, TSX_BIN, classifyExit, emptyStatus, evaluateHealth, recordResult, recordStart, runOnce, type JobSpec, type LoopDeps, type SchedulerStatus } from "../../scripts/scheduler-core.js";

const T0 = new Date("2026-01-01T00:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * MINUTE);
const JOB: JobSpec = { name: "j", command: ["x"], intervalMs: 10 * MINUTE, timeoutMs: MINUTE };

describe("exit-code classification (the contract of `pnpm media:cleanup`)", () => {
  it("0 ok, 2 failed items (retried next run), timeout, everything else crashed", () => {
    expect(classifyExit(0, false)).toBe("ok");
    expect(classifyExit(2, false)).toBe("failed_items");
    expect(classifyExit(1, false)).toBe("crashed");
    expect(classifyExit(137, false)).toBe("crashed");
    expect(classifyExit(null, false)).toBe("crashed");
    expect(classifyExit(0, true)).toBe("timeout"); // a killed job is never a success
  });
});

describe("status and health", () => {
  it("success resets the failure streak; failures accumulate and keep the last success time", () => {
    let s = emptyStatus(T0);
    s = recordResult(s, "j", { exitCode: 2, cls: "failed_items" }, at(1));
    s = recordResult(s, "j", { exitCode: 1, cls: "crashed" }, at(2));
    expect(s.jobs.j).toMatchObject({ consecutiveFailures: 2, lastSuccess: undefined, lastExitCode: 1 });
    s = recordResult(s, "j", { exitCode: 0, cls: "ok" }, at(3));
    s = recordResult(s, "j", { exitCode: 2, cls: "failed_items" }, at(4));
    expect(s.jobs.j).toMatchObject({ consecutiveFailures: 1, lastSuccess: at(3).toISOString() });
    expect(recordStart(s, "j", at(5)).jobs.j!.lastSuccess).toBe(at(3).toISOString());
  });
  it("is unhealthy when a job has not SUCCEEDED within 3 intervals (a failing job goes stale, a missing job too), healthy otherwise", () => {
    let s = emptyStatus(T0);
    expect(evaluateHealth(s, [JOB], at(29)).healthy).toBe(true); // within the start-up allowance
    expect(evaluateHealth(s, [JOB], at(31))).toEqual({ healthy: false, stale: ["j"] });
    s = recordResult(s, "j", { exitCode: 0, cls: "ok" }, at(30));
    expect(evaluateHealth(s, [JOB], at(59)).healthy).toBe(true);
    s = recordResult(s, "j", { exitCode: 2, cls: "failed_items" }, at(40)); // running but failing
    expect(evaluateHealth(s, [JOB], at(61)).healthy).toBe(false);
  });
  it("no status file at all is unhealthy", () => {
    expect(evaluateHealth(null, JOBS, T0)).toEqual({ healthy: false, stale: JOBS.map((j) => j.name) });
  });
  it("the real job table runs media cleanup at least hourly (the cleanup grace period is 1 h) and the db cleanup", () => {
    const media = JOBS.find((j) => j.name === "media-cleanup")!;
    expect(media.intervalMs).toBeLessThanOrEqual(60 * MINUTE);
    expect(JOBS.find((j) => j.name === "db-cleanup")).toBeDefined();
  });
  it("each job runs the SAME script as its package.json command, through tsx directly (no pnpm wrapper in the process tree)", () => {
    const scripts = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    for (const [job, pnpmScript] of [["media-cleanup", "media:cleanup"], ["db-cleanup", "db:cleanup"]] as const) {
      const [bin, ...args] = JOBS.find((j) => j.name === job)!.command;
      expect(bin, job).toBe(TSX_BIN);
      expect(`tsx ${args.join(" ")}`, job).toBe(scripts[pnpmScript]);
    }
  });
});

function harness(results: ({ exitCode: number | null; timedOut: boolean } | "stop")[]) {
  const lines: { line: string; level: string }[] = [];
  const now = T0.getTime();
  let status: SchedulerStatus = emptyStatus(T0);
  let stopped = false;
  let running = 0;
  let maxRunning = 0;
  const saved: SchedulerStatus[] = [];
  const alerts: { event: string; fields: Record<string, unknown> }[] = [];
  const deps: LoopDeps = {
    alert: async (event, fields) => void alerts.push({ event, fields }),
    run: async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      const next = results.shift();
      running--;
      if (next === "stop" || next === undefined) {
        stopped = true;
        return { exitCode: 0, timedOut: false };
      }
      return next;
    },
    now: () => new Date(now),
    write: (line, level) => lines.push({ line, level }),
    save: (s) => saved.push(s),
    getStatus: () => status,
    setStatus: (s) => {
      status = s;
    },
  };
  return { deps, lines, saved, alerts, getStatus: () => status, maxRunning: () => maxRunning, stopped: () => stopped };
}

/** What the maintenance queue does: one run per scheduler tick, until the harness says stop (BullMQ owns the timing since 2.2b). */
async function runTicks(job: JobSpec, h: ReturnType<typeof harness>): Promise<void> {
  while (!h.stopped()) await runOnce(job, h.deps);
}

describe("alerts (Bale, D14-3)", () => {
  it("every failed run alerts with the job and exit class; the first success after failures alerts 'recovered'; steady success is silent", async () => {
    const h = harness([{ exitCode: 0, timedOut: false }, { exitCode: 2, timedOut: false }, { exitCode: null, timedOut: true }, { exitCode: 0, timedOut: false }, { exitCode: 0, timedOut: false }, "stop"]);
    await runTicks(JOB, h);
    expect(h.alerts.map((a) => a.event)).toEqual(["job.failed", "job.failed", "job.recovered"]);
    expect(h.alerts[0]!.fields).toMatchObject({ job: "j", exitCode: 2, class: "failed_items", consecutiveFailures: 1 });
    expect(h.alerts[1]!.fields).toMatchObject({ class: "timeout", consecutiveFailures: 2 });
    expect(h.alerts[2]!.fields).toEqual({ job: "j", previousFailures: 2 });
  });
  it("without an alert dependency runs behave exactly as before (alerts are optional)", async () => {
    const h = harness([{ exitCode: 1, timedOut: false }, "stop"]);
    delete h.deps.alert;
    await expect(runTicks(JOB, h)).resolves.toBeUndefined();
  });
});

describe("one scheduled run", () => {
  it("logs a failure as a structured ERROR line with the exit code and class, success as info", async () => {
    const h = harness([{ exitCode: 2, timedOut: false }, { exitCode: 0, timedOut: false }, "stop"]);
    await runTicks(JOB, h);
    const parsed = h.lines.map((l) => ({ ...JSON.parse(l.line), _level: l.level }));
    const failed = parsed.find((p) => p.event === "job.failed")!;
    expect(failed).toMatchObject({ level: "error", _level: "error", job: "j", exitCode: 2, class: "failed_items", consecutiveFailures: 1 });
    expect(parsed.filter((p) => p.event === "job.finish")).toHaveLength(2); // the clean run, and the final stop sentinel
    expect(h.getStatus().jobs.j!.consecutiveFailures).toBe(0); // recovered by a later run
  });
  it("a crash and a timeout are errors too, and the next tick runs again (a failed run is retried next interval)", async () => {
    const h = harness([{ exitCode: 1, timedOut: false }, { exitCode: null, timedOut: true }, { exitCode: 0, timedOut: false }, "stop"]);
    await runTicks(JOB, h);
    const failed = h.lines.map((l) => JSON.parse(l.line)).filter((p) => p.event === "job.failed");
    expect(failed.map((f) => f.class)).toEqual(["crashed", "timeout"]);
    expect(failed.map((f) => f.consecutiveFailures)).toEqual([1, 2]);
  });
  // "never overlaps itself" is now a property of the maintenance queue (global concurrency 1): src/worker/worker.queue.test.ts.
  it("persists the status before and after every run, and log lines never contain the command line or environment", async () => {
    const h = harness([{ exitCode: 0, timedOut: false }, "stop"]);
    await runOnce(JOB, h.deps);
    expect(h.saved).toHaveLength(2);
    expect(h.saved[0]!.jobs.j!.lastStart).toBeDefined();
    expect(h.saved[1]!.jobs.j!.lastSuccess).toBeDefined();
    expect(h.lines.map((l) => l.line).join("\n")).not.toContain('"command"');
  });
});
