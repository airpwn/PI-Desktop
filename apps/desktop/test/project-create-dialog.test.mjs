import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readMainSource } from "./helpers/main-source.mjs";
import { readStoreSource } from "./helpers/store-source.mjs";

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

const [dialogSource, editDialog, store, api, protocol, main, styles] = await Promise.all([
  read("../src/components/ProjectCreateDialog.tsx"),
  read("../src/components/ProjectEditDialog.tsx"),
  readStoreSource(),
  read("../src/lib/api.ts"),
  read("../../../packages/shared/src/protocol.ts"),
  readMainSource(),
  read("../src/styles/project-create-dialog.css"),
]);

const dialog = dialogSource + await read("../src/components/ProjectFolderPicker.tsx");

test("create project dialog supports named multi-folder setup", () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /useBlockingOverlay\(\)/);
  assert.doesNotMatch(dialog, /project\.createNamePlaceholder/);
  assert.match(dialog, /api\.pickProjectFolders\(\)/);
  assert.match(dialog, /result\.folders/);
  assert.match(dialog, /project\.createRemoveFolder/);
  assert.match(dialog, /project\.createPrimary/);
  assert.match(dialog, /data-project-source="local"/);
  assert.doesNotMatch(dialog, /project\.createMemoryHint/);
  assert.doesNotMatch(dialog, /project\.createAddFolderHint/);
  assert.doesNotMatch(dialog, /aria-describedby="project-create-memory-hint"/);
  assert.match(dialog, /project-create-dialog-content/);
  assert.match(dialog, /project-create-dialog-section/);
  assert.match(dialog, /project-create-dialog-field-label/);
  // The name field is optional: the dialog derives a default from the source.
  assert.match(dialog, /defaultProjectName\(\{/);
  assert.match(dialog, /resolveProjectName\(name, defaultName\)/);
  assert.match(dialog, /setName\(defaultName\)/);
  assert.match(dialog, /: !projectName \|\| folders\.length === 0 \|\| busy/);
  assert.match(dialog, /querySelectorAll<HTMLElement>\(/);
});

test("create project dialog can create the project from a git checkout", () => {
  // Same dialog, same name field: the source toggle turns the folder list into
  // one repository URL plus its clone destination.
  assert.match(dialog, /type ProjectSource = "local" \| "git" \| "remote"/);
  assert.match(dialog, /data-project-source="git"/);
  assert.match(dialog, /parseGitCloneUrl/);
  assert.match(dialog, /project\.createSourceLabel/);
  assert.match(dialog, /project\.createRepositoryLabel/);
  assert.match(dialog, /project\.createChooseLocation/);
  assert.match(dialog, /project\.cloneDestHint/);
  assert.match(dialog, /api\.pickProjectFolders\(\)/);
  assert.match(dialog, /createProjectFromGit\(\{/);
  assert.match(dialog, /url: cloneTarget\.url/);
  assert.match(dialog, /parentPath: cloneParent/);
  assert.match(dialog, /!projectName \|\| !cloneTarget \|\| !cloneParent \|\| Boolean\(cloneWarning\) \|\| busy/);
  assert.match(dialog, /project\.cloning/);
  assert.match(store, /createProjectFromGit: async \(\{ name, url, parentPath, intoParent, cloneName \}\)/);
  assert.match(
    store,
    /api\.cloneProjectInto\(url, parentPath, \{\s*intoParent,\s*name: cloneName,\s*\}\)/,
  );
  assert.match(store, /folders: \[checkout\.path\], primaryPath: checkout\.path/);
  assert.match(api, /cloneProjectInto:\s*\(\s*url: string,\s*parentPath: string,\s*options\?: \{ intoParent\?: boolean; name\?: string \},\s*\)/);
  assert.match(protocol, /projectCloneCheckout:\s*"pi-desktop\/project\/cloneCheckout"/);
});

test("project creation creates one logical group with a primary workspace", () => {
  assert.match(store, /createProjectDialogOpen: boolean/);
  assert.match(
    store,
    /openProject: async \(options\) => \{\s*set\(\{\s*createProjectDialogOpen: true,\s*createProjectDialogRemoteHostKey: options\?\.remoteHostKey,\s*\/\/[^\n]*\n\s*createProjectDialogPrefill: options\?\.prefill \?\? null,\s*\}\)/,
  );
  assert.match(store, /createProjectFromFolders: async \(\{ name, folders, primaryPath \}\)/);
  assert.match(store, /const orderedFolders = \[/);
  assert.match(store, /api\.createProjectGroup\(normalizedName, orderedFolders\)/);
  assert.match(store, /const \{ groups \} = await api\.listProjectGroups\(\)/);
  assert.match(store, /group\.roots\.some\(\(root\) => normalizeProjectPath\(root\.path\) === selectedPath\)/);
  assert.match(store, /const existingPrimary = existing\.primaryPath \|\| orderedFolders\[0\]/);
  assert.match(store, /get\(\)\.activateProject\(existingPrimary/);
  assert.match(store, /created\.group\.primaryPath/);
  assert.doesNotMatch(store, /for \(const path of orderedFolders\)/);
  assert.match(store, /get\(\)\.renameProject\(groupPrimary, normalizedName\)/);
  assert.match(
    store,
    /set\(\{\s*createProjectDialogOpen: false,\s*createProjectDialogRemoteHostKey: undefined,\s*createProjectDialogPrefill: null,\s*onboarding,\s*page: "chat"\s*\}\)/,
  );
  // Folder picks and git checkouts share one project creation semantic.
  assert.match(store, /async function createNamedProjectGroup\(/);
  assert.match(store, /createProjectFromFolders: async \(\{ name, folders, primaryPath \}\) =>\s*createNamedProjectGroup\(/);
});

test("folder picker is a renderer-only multi-directory selection", () => {
  assert.match(protocol, /projectPickFolders:\s*"pi-desktop\/project\/pickFolders"/);
  assert.match(protocol, /projectGroupCreate:\s*"pi-desktop\/project-group\/create"/);
  assert.match(api, /createProjectGroup: \(name: string, folders: string\[\]\)/);
  assert.match(main, /project\.group\.create/);
  assert.match(api, /pickProjectFolders: \(\) =>[\s\S]*?projectPickFolders/);
  const start = main.indexOf("IPC.invoke.projectPickFolders");
  const end = main.indexOf("IPC.invoke.projectClone", start);
  const handler = main.slice(start, end);
  assert.ok(start >= 0 && end > start, "folder picker handler should exist");
  assert.match(handler, /openDirectory/);
  assert.match(handler, /multiSelections/);
  assert.match(handler, /createDirectory/);
  assert.match(handler, /folders:/);
  assert.doesNotMatch(handler, /workspace\.set/);
});

test("project folder pickers ignore repeated requests while a dialog is open", () => {
  for (const source of [dialog, editDialog]) {
    assert.match(source, /const folderPickerInFlightRef = useRef\(false\)/);
    assert.match(
      source,
      /if \(busyRef\.current \|\| folderPickerInFlightRef\.current\) return;/,
    );
    assert.match(
      source,
      /folderPickerInFlightRef\.current = true;\s*setFolderPickerBusy\(true\);[\s\S]*?api\.pickProjectFolders\(\)/,
    );
    assert.match(
      source,
      /folderPickerInFlightRef\.current = false;\s*setFolderPickerBusy\(false\);/,
    );
  }
  assert.match(main, /let projectPickerActive = false/);
  assert.match(main, /const openProjectPicker = async/);
  assert.match(main, /if \(!result \|\| result\.canceled/);
  assert.match(main, /const owner = getMainWindow\(\)/);
});

test("clone checkout handler clones without touching the active workspace", () => {
  const start = main.indexOf("IPC.invoke.projectCloneCheckout");
  const end = main.indexOf("IPC.invoke.projectSet", start);
  const handler = main.slice(start, end);
  assert.ok(start >= 0 && end > start, "clone checkout handler should exist");
  assert.match(handler, /parentPath/);
  assert.match(handler, /cloneGitRepository\(\{\s*url,\s*parentPath,\s*intoParent: input\.intoParent === true,\s*name: name \|\| undefined,\s*\}\)/);
  // The renderer still creates the group, so the handler never sets a workspace.
  assert.doesNotMatch(handler, /workspace\.set/);
  assert.doesNotMatch(handler, /dialog\.showOpenDialog/);
});

test("the stylesheet keeps balanced blocks and no duplicated tail", () => {
  // A stray trailing fragment still matched every surface assertion above while
  // breaking the Tailwind build ("Missing opening {"), so the sheet's blocks are
  // checked structurally instead of by pattern.
  const open = (styles.match(/{/g) ?? []).length;
  const close = (styles.match(/}/g) ?? []).length;
  assert.equal(open, close, "every style block must be closed");
  const tail = styles.slice(-200);
  assert.equal(
    (tail.match(/transition: none;/g) ?? []).length,
    1,
    "the reduced-motion block keeps exactly one declaration group",
  );
  assert.match(tail, /\}\s*\}\s*$/);
});

test("create project dialog remains usable on narrow screens and reduced motion", () => {
  assert.match(styles, /width: min\(100%, 480px\)/);
  assert.match(styles, /border-radius: var\(--radius-lg-plus\)/);
  assert.match(styles, /font-size: var\(--text-lg\)/);
  assert.match(styles, /font-size: var\(--text-base\)/);
  assert.match(styles, /gap: 16px/);
  assert.match(styles, /padding: 14px 18px 18px/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /align-items: flex-end/);
  assert.match(styles, /min-height: 48px/);
  assert.match(styles, /project-create-dialog-actions/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /overflow-y: auto/);
  assert.match(styles, /\.project-create-dialog-source-options \{/);
  assert.match(styles, /\.project-create-dialog-source-option\.is-active \{/);
  assert.match(styles, /\.project-create-dialog-location\.is-chosen/);
  assert.match(styles, /\.project-create-dialog-clone-hint \{/);
});

test("create project dialog stays lineless (D297)", () => {
  assert.match(styles, /\.project-create-dialog-source-option \{[^}]*border: 0;/);
  assert.match(
    styles,
    /\.project-create-dialog-source-option\.is-active \{[^}]*background: var\(--ds-tile-deep\);/,
  );
  assert.doesNotMatch(styles, /border: 1px solid var\(--ds-border-subtle\)/);
  assert.doesNotMatch(styles, /\.project-create-dialog-name-field:focus-visible/);
  assert.doesNotMatch(styles, /outline-offset: 2px/);
  assert.match(
    styles,
    /\.project-create-dialog-source-option:focus-visible,[^}]*box-shadow: 0 0 0 2px color-mix\(in oklab, var\(--ds-accent\) 22%, transparent\);/,
  );
});

test("git clone subfolder toggle, custom name, and inspect warnings are wired", () => {
  // The toggle defaults to OFF: clone straight into the picked folder, and the
  // repository-name input only exists in subfolder mode.
  assert.match(dialog, /const \[cloneIntoSubfolder, setCloneIntoSubfolder\] = useState\(false\)/);
  assert.match(dialog, /const \[customRepoName, setCustomRepoName\] = useState\(""\)/);
  assert.match(dialog, /intoParent: !cloneIntoSubfolder,/);
  assert.match(dialog, /cloneName: cloneIntoSubfolder \? cloneDestName : undefined,/);
  assert.match(dialog, /project\.createCloneRepoNameLabel/);
  assert.match(dialog, /project\.createCloneSubfolderToggle/);
  assert.match(dialog, /\{cloneIntoSubfolder \? \(\s*<Input\s+id="project-create-clone-repo-name"/);
  assert.match(dialog, /project\.cloneParentHint/);
  assert.match(dialog, /project\.cloneDestHint/);
  // A clone warning blocks both the click path and any implicit submit.
  assert.match(dialog, /if \(!cloneTarget \|\| !cloneParent \|\| cloneWarning\) return;/);
  assert.match(dialog, /cloneWarning = customRepoNameInvalid/);
  assert.match(dialog, /project\.cloneRepoNameInvalid/);
  assert.match(dialog, /role="alert"/);
  // Inline warnings are UX-only: main still validates authoritatively at clone time.
  assert.match(dialog, /api\s+\.inspectPath\(/);
  assert.match(dialog, /project\.cloneParentNotEmptyWarning/);
  assert.match(dialog, /project\.cloneDestExistsWarning/);
  assert.match(api, /inspectPath: \(path: string\)/);
  assert.match(protocol, /fsInspectPath:\s*"pi-desktop\/fs\/inspectPath"/);
  assert.match(main, /IPC\.invoke\.fsInspectPath/);
  // The CLI opens the create form with a prefill instead of a confirmation prompt.
  assert.match(dialog, /state\.createProjectDialogPrefill/);
  assert.match(store, /createProjectDialogPrefill: options\?\.prefill \?\? null/);
});

test("git mode keeps the project name manual and the subdirectory name sticky", () => {
  // Scope "Create Project > Git Repository": the name field is never seeded
  // from the repository URL or the chosen folder while the Git source is
  // active, and submit does not fall back to a derived default — an empty
  // name leaves the Clone button disabled.
  assert.match(dialog, /if \(source === "git" \|\| nameTouchedRef\.current\) return;/);
  assert.match(
    dialog,
    /source === "git" \? clampProjectName\(name\) : resolveProjectName\(name, defaultName\)/,
  );
  // Checking the subdirectory toggle seeds its input from the parsed
  // repository name exactly once; later URL edits never overwrite it.
  assert.match(
    dialog,
    /if \(!customRepoName\.trim\(\) && cloneTarget\) setCustomRepoName\(cloneTarget\.name\)/,
  );
  assert.match(dialog, /if \(repoNameSeededRef\.current\) return;/);
});
