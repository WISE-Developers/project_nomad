import type { ChildProcess } from 'child_process';

const AFTER_SIGKILL_MS = 5000;

const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

/**
 * Sends SIGTERM, then SIGKILL after `graceMs`, and resolves only once the process has
 * exited. Rejects if it is still alive after SIGKILL, so a caller never reports a process
 * stopped that is not.
 */
export async function stopChildProcess(child: ChildProcess, graceMs: number, label: string): Promise<void> {
  if (hasExited(child)) return;

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const within = (ms: number) =>
    Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(hasExited(child)), ms))]);

  child.kill('SIGTERM');
  if (await within(graceMs)) return;

  child.kill('SIGKILL');
  if (await within(AFTER_SIGKILL_MS)) return;

  throw new Error(`${label} (pid ${child.pid}) was still running after SIGKILL`);
}
