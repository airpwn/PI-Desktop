import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Positional arguments that could name a project folder. Skips argv[0] and
 * every flag-style argument (`--pi-managed-storage`,
 * `--pi-desktop-locale=...`, plugin-panel args), and also Electron's own
 * app-path argument: dev and E2E launches are `electron .` or
 * `electron <app-dir>`, which is the application being loaded, never a
 * request to open that folder as a project.
 */
function folderArgs(
  argv: readonly string[],
  cwd: string,
  appPath?: string | null,
): { arg: string; candidate: string }[] {
  const appPathResolved = appPath ? resolve(appPath) : null;
  const entries: { arg: string; candidate: string }[] = [];
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith("-")) continue;
    const candidate = isAbsolute(arg) ? arg : resolve(cwd, arg);
    if (appPathResolved && candidate === appPathResolved) continue;
    entries.push({ arg, candidate });
  }
  return entries;
}

/**
 * Extract the folder a CLI launch should open (`pi-desktop <path>`).
 * Pure and testable: returns the first argument that resolves to an
 * existing directory.
 */
export function parseCliProjectPath(
  argv: readonly string[],
  cwd: string,
  appPath?: string | null,
): string | null {
  for (const { candidate } of folderArgs(argv, cwd, appPath)) {
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Unreadable path: treat like a missing path and keep scanning.
    }
  }
  return null;
}

/**
 * First positional argument that does not exist on disk at all — the only case
 * worth a "folder not found" toast. Existing-but-not-a-directory arguments are
 * silently ignored, and Electron's app-path argument is excluded above.
 */
export function findRejectedCliArg(
  argv: readonly string[],
  cwd: string,
  appPath?: string | null,
): string | null {
  for (const { arg, candidate } of folderArgs(argv, cwd, appPath)) {
    if (!existsSync(candidate)) return arg;
  }
  return null;
}

export type PendingProjectOpen = { path: string | null; rejectedArg: string | null };

let pending: PendingProjectOpen | null = null;

/** Parse a CLI invocation and queue its outcome (valid folder or rejected arg). */
export function queueCliProjectOpen(
  argv: readonly string[],
  cwd: string,
  appPath?: string | null,
): void {
  const path = parseCliProjectPath(argv, cwd, appPath);
  if (path) {
    pending = { path, rejectedArg: null };
    return;
  }
  const rejectedArg = findRejectedCliArg(argv, cwd, appPath);
  // ponytail: single slot, last write wins (VS Code parity); flags-only
  // invocations queue nothing and never clobber a real pending folder.
  if (rejectedArg) pending = { path: null, rejectedArg };
}

/** Take the queued CLI outcome (one-shot delivery). */
export function takePendingProjectOpen(): PendingProjectOpen | null {
  const taken = pending;
  pending = null;
  return taken;
}
