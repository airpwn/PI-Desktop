import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

const require = createRequire(import.meta.url);
const { build } = createRequire(
  new URL("../../../packages/agent-runtime/package.json", import.meta.url),
)("esbuild");

const bundled = await build({
  stdin: {
    contents: 'export * from "./cli-project-open";',
    resolveDir: fileURLToPath(new URL("../electron/main/bootstrap/", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const modulePath = join(
  await mkdtemp(join(tmpdir(), "pi-cli-project-open-")),
  "cli-project-open.cjs",
);
await writeFile(modulePath, bundled.outputFiles[0].text);
const {
  parseCliProjectPath,
  findRejectedCliArg,
  queueCliProjectOpen,
  takePendingProjectOpen,
} = require(modulePath);

// argv[0] is the executable and is never a candidate.
const ENTRY = "/usr/bin/pi-desktop";

async function withTempDir(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-cli-open-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "myrepo");
  const file = join(root, "notes.txt");
  await mkdir(folder);
  await writeFile(file, "hello");
  return { root, folder, file };
}

test("parseCliProjectPath resolves `.` against the launch cwd", async (t) => {
  const { folder } = await withTempDir(t);
  assert.equal(parseCliProjectPath([ENTRY, "."], folder), folder);
  assert.equal(parseCliProjectPath([ENTRY, "sub/.."], folder), folder);
});

test("parseCliProjectPath accepts an absolute directory", async (t) => {
  const { folder } = await withTempDir(t);
  assert.equal(parseCliProjectPath([ENTRY, folder], "/"), folder);
});

test("parseCliProjectPath skips executable and flag-style arguments", async (t) => {
  const { folder } = await withTempDir(t);
  const argv = [
    ENTRY,
    "--pi-managed-storage",
    "--pi-desktop-locale=de",
    "--panel=plugin",
    folder,
  ];
  assert.equal(parseCliProjectPath(argv, "/"), folder);
});

test("parseCliProjectPath ignores files, missing paths, and empty argv", async (t) => {
  const { file, root } = await withTempDir(t);
  assert.equal(parseCliProjectPath([ENTRY, file], root), null);
  assert.equal(parseCliProjectPath([ENTRY, join(root, "nope")], root), null);
  assert.equal(parseCliProjectPath([ENTRY], root), null);
  assert.equal(parseCliProjectPath([ENTRY, "--flag-only"], root), null);
});

test("findRejectedCliArg reports only arguments missing from disk", async (t) => {
  const { folder, file, root } = await withTempDir(t);
  const missing = join(root, "does-not-exist");
  assert.equal(findRejectedCliArg([ENTRY, missing], root), missing);
  assert.equal(findRejectedCliArg([ENTRY, file], root), null);
  assert.equal(findRejectedCliArg([ENTRY, folder], root), null);
  assert.equal(findRejectedCliArg([ENTRY, "--flag"], root), null);
});

test("queueCliProjectOpen hands the folder over exactly once", async (t) => {
  const { folder } = await withTempDir(t);
  queueCliProjectOpen([ENTRY, folder], "/");
  assert.deepEqual(takePendingProjectOpen(), { path: folder, rejectedArg: null });
  assert.equal(takePendingProjectOpen(), null);
});

test("a flags-only launch never clobbers a queued folder", async (t) => {
  const { folder } = await withTempDir(t);
  queueCliProjectOpen([ENTRY, folder], "/");
  queueCliProjectOpen([ENTRY, "--pi-managed-storage"], "/");
  assert.deepEqual(takePendingProjectOpen(), { path: folder, rejectedArg: null });
});

test("a rejected folder is queued so the user is told about it", async (t) => {
  const { root } = await withTempDir(t);
  const missing = join(root, "gone");
  queueCliProjectOpen([ENTRY, missing], root);
  assert.deepEqual(takePendingProjectOpen(), { path: null, rejectedArg: missing });
});

const [protocolSource, apiSource, entrySource, activationSource, lifecycleSource, runtimeSource, settingsTypesSource, settingsPageSource] =
  await Promise.all([
    read("../../../packages/shared/src/protocol.ts"),
    read("../src/lib/api.ts"),
    read("../electron/main/entry.ts"),
    read("../electron/main/bootstrap/app-activation.ts"),
    read("../electron/main/bootstrap/app-lifecycle.ts"),
    read("../src/features/app/useAppShellRuntime.tsx"),
    read("../../../packages/shared/src/types/settings.ts"),
    read("../src/features/settings/SettingsPage.tsx"),
  ]);

test("the project-open event is a whitelisted renderer event", () => {
  assert.match(
    protocolSource,
    /projectOpenRequest:\s*"pi-desktop\/app\/event\/projectOpenRequest"/,
  );
  // The whitelist derives both invoke and event channels, so the new event is
  // reachable from the preload bridge without a manual registration.
  assert.match(protocolSource, /\.\.\.Object\.values\(IPC\.event\)/);
});

test("the renderer API listens on the project-open channel", () => {
  assert.match(
    apiSource,
    /onProjectOpenRequest[\s\S]*?IPC\.event\.projectOpenRequest/,
  );
});

test("both second-instance paths parse the CLI folder", () => {
  assert.match(entrySource, /second-instance[\s\S]*?queueCliProjectOpen\(/);
  assert.match(entrySource, /queueCliProjectOpen\(process\.argv, process\.cwd\(\)\)/);
  assert.match(
    activationSource,
    /second-instance[\s\S]*?queueCliProjectOpen\(argv, workingDirectory\)/,
  );
});

test("delivery waits for the renderer before sending the path", () => {
  assert.match(lifecycleSource, /takePendingProjectOpen\(\)/);
  assert.match(lifecycleSource, /waitForMenuRenderer\([\s\S]*?IPC\.event\.projectOpenRequest/);
});

test("the renderer buffers a project request until the store is ready", () => {
  assert.match(runtimeSource, /onProjectOpenRequest\(/);
  assert.match(runtimeSource, /pendingCliProjectOpenRef/);
  assert.match(runtimeSource, /handleCliProjectOpen\(/);
});

test("the CLI open behavior is a persisted setting with a General row", () => {
  assert.match(settingsTypesSource, /cliOpenFolderBehavior\?:\s*"prompt"\s*\|\s*"auto"\s*\|\s*"none"/);
  assert.match(settingsPageSource, /cliOpenFolderNone/);
  assert.match(settingsPageSource, /t\("settings\.cliOpenFolderTitle"\)/);
  assert.match(settingsPageSource, /cliOpenFolderBehavior/);
});

const [projectSliceSource, appStateSource, initialStateSource] = await Promise.all([
  read("../src/stores/slices/project-slice.ts"),
  read("../src/stores/app-state.ts"),
  read("../src/stores/slices/initial-state.ts"),
]);

test("the CLI open contract activates, skips, auto-creates, or prefills the form", () => {
  const start = projectSliceSource.indexOf("handleCliProjectOpen: async (path) => {");
  const end = projectSliceSource.indexOf("toggleSessionPinned:", start);
  const handler = projectSliceSource.slice(start, end);
  assert.ok(start >= 0 && end > start, "CLI open handler should exist");
  // Known folder: "none" keeps the current chat, the other modes activate it.
  assert.match(handler, /cliOpenFolderBehavior !== "none"/);
  assert.match(handler, /activateProject\(existing\.primaryPath \|\| path\)/);
  // Unknown folder: "auto" creates silently; "prompt"/"none" open the Create
  // Project form prefilled with the folder and the clone destination.
  assert.match(handler, /cliOpenFolderBehavior === "auto"/);
  assert.match(handler, /createNamedProjectGroup\(/);
  assert.match(handler, /defaultProjectName\(\{ source: "local", folders: \[path\] \}\)/);
  assert.match(handler, /openProject\(\{ prefill: \{ folders: \[path\], cloneParent: path \} \}\)/);
  // The confirmation dialog is gone; only the prefill state remains.
  assert.doesNotMatch(projectSliceSource, /projectOpenPromptPath|ProjectOpenPrompt/);
  assert.doesNotMatch(appStateSource, /projectOpenPromptPath|ProjectOpenPrompt/);
  assert.match(appStateSource, /createProjectDialogPrefill:/);
  assert.match(initialStateSource, /createProjectDialogPrefill: null/);
});
