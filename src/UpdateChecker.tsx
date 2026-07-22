import { useEffect, useState } from "react";
import { checkForUpdates, downloadShareLink, getUpdateRepo, openDownload, type UpdateResult } from "./updates";

// Small, self-contained "Check for updates" control. Shows the current version,
// checks the author's published update file (Dropbox by default, GitHub only if
// a repository is set), and offers the download when a newer build exists.
// Used in the hub header and in Settings.
export function UpdateChecker({ configurable = false }: { configurable?: boolean }) {
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const repo = getUpdateRepo();
  const [copied, setCopied] = useState(false);
  const [installing, setInstalling] = useState(false);

  // The address to hand to another person. A GitHub repository, when one is
  // set, still gives a stable /releases/latest page; otherwise it is the
  // installer named in the author's own update file, which is why a check runs
  // by itself on the Settings screen — the share buttons need an answer before
  // anyone presses anything.
  const shared = downloadShareLink(repo)
    ?? (result?.state === "available" ? result.info.url
      : result?.state === "current" ? result.downloadUrl ?? null
      : null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if ("__TAURI_INTERNALS__" in window) {
        try {
          const { getVersion } = await import("@tauri-apps/api/app");
          const value = await getVersion();
          if (alive) setVersion(value);
        } catch { /* leave blank */ }
      } else if (alive) {
        setVersion("dev");
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (configurable && version && !result && !busy) void check();
    // Once, as soon as the version is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configurable, version]);

  async function check() {
    setBusy(true);
    setResult(null);
    try {
      // Never fail silently: if the app version could not be read, say so
      // instead of leaving the button looking dead.
      if (!version) {
        setResult({ state: "error", message: "The app version could not be read, so updates cannot be compared." });
        return;
      }
      setResult(await checkForUpdates(version));
    } finally {
      setBusy(false);
    }
  }

  async function copyShareLink(link: string) {
    try {
      await navigator.clipboard?.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }

  return <div className="update-checker">
    <div className="update-line">
      <span className="app-version">Version {version || "…"}</span>
      <button className="text-button" onClick={() => void check()} disabled={busy}>
        {busy ? "Checking…" : "Check for updates"}
      </button>
    </div>

    {result?.state === "current" && <span className="update-status ok">You're on the latest version.</span>}
    {result?.state === "unconfigured" && <span className="update-status warn">No update source is set on this build.</span>}
    {result?.state === "error" && <span className="update-status warn">{result.message}</span>}
    {result?.state === "available" && <div className="update-available">
      <span className="update-status new">Update ready: version {result.info.version}</span>
      {result.info.url
        ? <button className="primary tiny" disabled={installing} onClick={() => {
            setInstalling(true);
            void import("@tauri-apps/api/core")
              .then(({ invoke }) => invoke("download_and_install_update", { url: result.info.url }))
              .catch(() => openDownload(result.info.url!))
              .finally(() => setInstalling(false));
          }}>{installing ? "Downloading…" : "Download & install"}</button>
        : <button className="primary tiny" onClick={() => void openDownload(result.info.page)}>Open release page</button>}
      {result.info.notes && <p className="update-notes">{result.info.notes.slice(0, 400)}</p>}
    </div>}

    {configurable && shared && <div className="share-link">
      <span className="share-label">Shareable download link — send this to anyone:</span>
      <code className="share-url">{shared}</code>
      <div className="share-actions">
        <button className="primary tiny" onClick={() => void copyShareLink(shared)}>{copied ? "Copied ✓" : "Copy link"}</button>
        <button className="text-button" onClick={() => void openDownload(shared)}>Open</button>
        <button className="primary tiny" onClick={() => {
          const link = shared;
          void import("@tauri-apps/api/core").then(({ invoke }) =>
            invoke("open_url", { url: "mailto:?subject=" + encodeURIComponent("MaggotClaw Games") + "&body=" + encodeURIComponent("Download MaggotClaw Games here: " + link) })
          );
        }}>Email</button>
        <button className="primary tiny" onClick={() => {
          const link = shared;
          const number = window.prompt("Their phone number (leave blank to just open your messaging app):") ?? "";
          const clean = number.replace(/[^\d+]/g, "");
          void import("@tauri-apps/api/core").then(({ invoke }) =>
            invoke("open_url", { url: `sms:${clean}?body=` + encodeURIComponent("Download MaggotClaw Games here: " + link) })
          ).catch(() => void copyShareLink(link));
        }}>Text</button>
        <button className="primary tiny" onClick={() => {
          void copyShareLink(shared);
          void import("@tauri-apps/api/webviewWindow").then(async ({ WebviewWindow }) => {
            const existing = await WebviewWindow.getByLabel("discord");
            if (existing) { await existing.show(); await existing.setFocus(); return; }
            // eslint-disable-next-line no-new
            new WebviewWindow("discord", { url: "https://discord.com/app", title: "MaggotClaw Messages", width: 1100, height: 780, resizable: true, focus: true });
          });
        }}>Message</button>
      </div>
    </div>}
  </div>;
}
