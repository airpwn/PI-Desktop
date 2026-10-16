import { useEffect, useRef, useState } from "react";
import { useBlockingOverlay } from "../lib/blocking-overlay";
import { portalToBody } from "../lib/portal-visibility";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { OverlayBackdrop, Button, TooltipButton } from "./ui";
import { IconCircleAlert, IconClose } from "./icons";

/**
 * Confirmation for a folder passed on the CLI (`pi-desktop <path>`) that does
 * not belong to any project yet. Default behavior (`cliOpenFolderBehavior`
 * absent or "prompt") stops here; "auto" creates the project without asking.
 */
export function ProjectOpenPromptDialog() {
  const path = useAppStore((state) => state.projectOpenPromptPath);
  if (!path) return null;
  return <ProjectOpenPromptDialogContent path={path} />;
}

function ProjectOpenPromptDialogContent({ path }: { path: string }) {
  useBlockingOverlay();
  const { t } = useTranslation();
  const dismiss = useAppStore((state) => state.dismissProjectOpenPrompt);
  const confirm = useAppStore((state) => state.confirmProjectOpenPrompt);
  const showToast = useAppStore((state) => state.showToast);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => dialogRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) dismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled])",
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [dismiss]);

  const confirmCreate = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await confirm();
    } catch (error) {
      // The store already cleared the pending path, so a failure here is only
      // reportable — the app stays usable on its previous project.
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const dialog = (
    <OverlayBackdrop
      className="overlay project-instructions-dialog-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busyRef.current) dismiss();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog project-instructions-dialog project-open-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-open-prompt-title"
        aria-describedby="project-open-prompt-body project-open-prompt-path"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="project-instructions-dialog-head">
          <h2 id="project-open-prompt-title" className="project-instructions-dialog-title">
            <IconCircleAlert size={17} aria-hidden />
            {t("project.cliPromptTitle")}
          </h2>
          <TooltipButton
            type="button"
            className="project-instructions-dialog-close"
            tooltip={t("project.cliPromptCancel")}
            ariaLabel={t("project.cliPromptCancel")}
            disabled={busy}
            onClick={dismiss}
          >
            <IconClose size={16} />
          </TooltipButton>
        </div>
        <div className="project-delete-dialog-body">
          <p id="project-open-prompt-body" className="project-memory-dialog-description">
            {t("project.cliPromptBody")}
          </p>
          <p id="project-open-prompt-path" className="project-memory-dialog-hint">
            {path}
          </p>
        </div>
        <div className="project-instructions-dialog-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={dismiss}>
            {t("project.cliPromptCancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="project-open-prompt-dialog-confirm"
            disabled={busy}
            onClick={() => void confirmCreate()}
          >
            {t("project.cliPromptCreate")}
          </Button>
        </div>
      </div>
    </OverlayBackdrop>
  );

  return typeof document === "undefined" ? dialog : portalToBody(dialog);
}
