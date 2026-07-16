import { useEffect, useState } from "react";
import { checkForUpdates, downloadShareLink, getUpdateRepo, isValidRepo, openDownload, setUpdateRepo, type UpdateResult } from "./updates";

// Small, self-contained "Check for updates" control. Shows the current version,
// checks the configured GitHub release feed, and offers the download when a
// newer build exists. Used in the hub header and in Settings.
export function UpdateChecker({ configurable = false }: { configurable?: boolean }) {
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [repo, setRepo] = useState(getUpdateRepo);
  const [copied, setCopied] = useState(false);

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

  async function check() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await checkForUpdates(version));
    } finally {
      setBusy(false);
    }
  }

  function saveRepo(next: string) {
    setRepo(next);
    setUpdateRepo(next);
    setResult(null);
    setCopied(false);
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
      <button className="text-button" onClick={() => void check()} disabled={busy || !version}>
        {busy ? "Checking…" : "Check for updates"}
      </button>
    </div>

    {result?.state === "current" && <span className="update-status ok">You're on the latest version.</span>}
    {result?.state === "unconfigured" && <span className="update-status warn">No update source set yet{configurable ? " — add your GitHub repo below." : "."}</span>}
    {result?.state === "error" && <span className="update-status warn">{result.message}</span>}
    {result?.state === "available" && <div className="update-available">
      <span className="update-status new">Update ready: version {result.info.version}</span>
      {result.info.url
        ? <button className="primary tiny" onClick={() => void openDownload(result.info.url!)}>Download installer</button>
        : <button className="primary tiny" onClick={() => void openDownload(result.info.page)}>Open release page</button>}
      {result.info.notes && <p className="update-notes">{result.info.notes.slice(0, 400)}</p>}
    </div>}

    {configurable && <label className="update-repo">Update source (GitHub owner/repo)
      <input
        value={repo}
        placeholder="e.g. your-name/the-long-rot"
        onChange={(event) => saveRepo(event.target.value)}
        autoComplete="off"
      />
      {repo && !isValidRepo(repo) && <small className="update-status warn">Use the form owner/repo.</small>}
    </label>}

    {configurable && downloadShareLink(repo) && <div className="share-link">
      <span className="share-label">Shareable download link — send this to anyone:</span>
      <code className="share-url">{downloadShareLink(repo)}</code>
      <div className="share-actions">
        <button className="primary tiny" onClick={() => void copyShareLink(downloadShareLink(repo)!)}>{copied ? "Copied ✓" : "Copy link"}</button>
        <button className="text-button" onClick={() => void openDownload(downloadShareLink(repo)!)}>Open</button>
      </div>
    </div>}
  </div>;
}
