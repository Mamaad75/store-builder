import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runJobProcess, signalJobTree } from "../../scripts/scheduler-process";

/**
 * Real processes (no fakes): a job is a process TREE, as in production (tsx starts a second node process). Regression for the phase 13
 * review finding: a timeout used to kill only the direct child, leaving the real job running as an orphan next to the following run.
 */
const posix = process.platform !== "win32";
let dir: string | undefined;
const leaked: number[] = [];

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return cond();
}

/** A parent that starts a long-lived grandchild, records its pid in `pidFile`, then never exits by itself. */
const treeCommand = (pidFile: string) => [
  process.execPath,
  "-e",
  `const g = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
   require("node:fs").writeFileSync(process.argv[1], String(g.pid));
   setInterval(() => {}, 1000);`,
  pidFile,
];

afterEach(() => {
  for (const pid of leaked.splice(0)) if (alive(pid)) process.kill(pid, "SIGKILL");
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("scheduler job processes", () => {
  it("passes the job's own exit code through unchanged (2 = failed items is not reported as a crash)", async () => {
    expect(await runJobProcess([process.execPath, "-e", "process.exit(2)"], 10_000)).toEqual({ exitCode: 2, timedOut: false });
    expect(await runJobProcess([process.execPath, "-e", "process.exit(0)"], 10_000)).toEqual({ exitCode: 0, timedOut: false });
  });

  it.skipIf(!posix)("a timeout kills the WHOLE job tree, grandchildren included (no orphan keeps running into the next run)", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "sched-proc-"));
    const pidFile = path.join(dir, "grandchild.pid");
    const r = await runJobProcess(treeCommand(pidFile), 2_000);
    expect(r.timedOut).toBe(true);
    expect(existsSync(pidFile), "the job started its grandchild before the timeout").toBe(true);
    const grandchild = Number(readFileSync(pidFile, "utf8"));
    leaked.push(grandchild);
    expect(await waitFor(() => !alive(grandchild), 3_000), "grandchild must be dead after the timeout").toBe(true);
  });

  it.skipIf(!posix)("the shutdown signal reaches the whole tree of a running job", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "sched-proc-"));
    const pidFile = path.join(dir, "grandchild.pid");
    const running = new Set<ChildProcess>();
    const done = runJobProcess(treeCommand(pidFile), 30_000, running);
    expect(await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").length > 0, 5_000)).toBe(true);
    const grandchild = Number(readFileSync(pidFile, "utf8"));
    leaked.push(grandchild);
    for (const c of running) signalJobTree(c, "SIGTERM");
    const r = await done;
    expect(r.timedOut).toBe(false);
    expect(running.size).toBe(0);
    expect(await waitFor(() => !alive(grandchild), 3_000), "grandchild must be dead after the shutdown signal").toBe(true);
  });
});
