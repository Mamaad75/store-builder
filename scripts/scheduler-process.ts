import { spawn, type ChildProcess } from "node:child_process";

/**
 * Process handling of the scheduler (phase 13 review fix). A job is a process TREE (tsx starts a second node process, and any
 * wrapper such as pnpm or sh adds more), so signalling only the direct child would leave the real job running as an orphan that
 * still holds store locks and database connections, and the next run could overlap with it. Every job therefore starts as the
 * leader of its OWN process group (`detached: true`), and a timeout or shutdown signals the whole group at once.
 */
export interface RunResult {
  exitCode: number | null;
  timedOut: boolean;
}

/** Sends `signal` to the job's whole process group; falls back to the child alone where groups do not exist (Windows). */
export function signalJobTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (e) {
    // ESRCH: the group is already gone. Anything else is unexpected and must not be hidden.
    if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
  }
}

/**
 * Runs one job with a hard timeout. On timeout the whole process tree is killed (SIGKILL), so a timed-out job can never keep
 * running next to the following run. `track` lets the caller signal running jobs on shutdown.
 */
export function runJobProcess(
  command: string[],
  timeoutMs: number,
  track: { add: (c: ChildProcess) => void; delete: (c: ChildProcess) => void } = { add: () => {}, delete: () => {} },
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command;
    const child = spawn(cmd!, args, { stdio: "inherit", env, detached: process.platform !== "win32" });
    track.add(child);
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      track.delete(child);
      resolve({ exitCode, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      signalJobTree(child, "SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => finish(code));
    child.on("error", () => finish(null));
  });
}
