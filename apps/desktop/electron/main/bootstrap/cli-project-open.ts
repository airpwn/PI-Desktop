import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Extract the folder a CLI launch should open (`pi-desktop <path>`).
 * Pure and testable: skips argv[0] and every flag-style argument
 * (`--pi-managed-storage`, `--pi-desktop-locale=...`, plugin-panel args),
 * then returns the first argument that resolves to an existing directory.
 */
export function parseCliProjectPath(argv: readonly string[], cwd: string): string | null {
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith("-")) continue;
    const candidate = isAbsolute(arg) ? arg : resolve(cwd, arg);
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Unreadable path: treat like a missing path and keep scanning.
    }
  }
  return null;
}

/**
 * First non-flag argument that does not exist on disk at all — the only case
 * worth a "folder not found" toast. Existing-but-not-a-directory arguments are
 * silently ignored, and dev-mode argv[1] (the built entry file) exists, so it
 * is never reported.
 */
export function findRejectedCliArg(argv: readonly string[], cwd: string): string | null {
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith("-")) continue;
    const candidate = isAbsolute(arg) ? arg : resolve(cwd, arg);
    if (!existsSync(candidate)) return arg;
  }
  return null;
}

export type PendingProjectOpen = { path: string | null; rejectedArg: string | null };

let pending: PendingProjectOpen | null = null;

/** Parse a CLI invocation and queue its outcome (valid folder or rejected arg). */
export function queueCliProjectOpen(argv: readonly string[], cwd: string): void {
  const path = parseCliProjectPath(argv, cwd);
  if (path) {
    pending = { path, rejectedArg: null };
    return;
  }
  const rejectedArg = findRejectedCliArg(argv, cwd);
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
