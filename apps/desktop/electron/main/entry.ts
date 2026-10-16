import { app, BrowserWindow } from "electron";
import { defaultDataDir, hasSingleInstanceLock, singleInstanceRequired } from "./installation";
import { queueCliProjectOpen } from "./bootstrap/cli-project-open";
import { prepareStorage } from "./storage/bootstrap";

// Do not top-level-await Electron readiness: module evaluation gates the ready event.
// The full composition root is imported only after offline maintenance has finished.
if (hasSingleInstanceLock) {
  let booted = false;
  app.on("second-instance", (_event, argv, workingDirectory) => {
    // Queue always: pre-boot the window may not exist yet, and the full
    // composition root (which owns delivery) is not registered until later.
    queueCliProjectOpen(argv, workingDirectory);
    if (booted) return;
    const window = BrowserWindow.getAllWindows()[0];
    window?.show();
    window?.focus();
  });
  // Cold start: the launching terminal's own arguments.
  queueCliProjectOpen(process.argv, process.cwd());
  void prepareStorage(defaultDataDir, !singleInstanceRequired)
    .then(() => {
      booted = true;
      return import("./index");
    })
    .catch((error: unknown) => {
      console.error("Storage startup failed", error instanceof Error ? error.message : String(error));
      app.exit(1);
    });
}
