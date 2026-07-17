import { invoke } from "@tauri-apps/api/core";
import { BrowserSpeechPlayer } from "./speech";
import { useEffect, useMemo, useRef, useState } from "react";
import { compareVersions, parseDoc, type ParsedDoc, type ProjectDocument } from "./projectDocs";
import { describeDoc, resolveQuickOpen } from "./quickOpen";
import { brainHeadline, parseRegistry, type RegistryEntity, type StoryBrain } from "./storyBrain";

interface SearchHit {
  localRelativePath: string;
  matchCount: number;
  snippet: string;
}

type GroupMode = "chapter" | "type" | "folder";
type View = "files" | "chapters" | "codex";

const TYPE_ORDER = ["Master Codex", "Codex", "Blueprint", "Development", "Draft", "Reader Copy", "Other"];

function groupKey(parsed: ParsedDoc, mode: GroupMode): string {
  if (mode === "type") return parsed.typeLabel;
  if (mode === "folder") return parsed.folder;
  return parsed.chapter != null ? `Chapter ${String(parsed.chapter).padStart(2, "0")}` : "Codex & Reference";
}

function sortGroups(mode: GroupMode, keys: string[]): string[] {
  if (mode === "type") {
    return keys.sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }
  return keys.sort((a, b) => {
    if (a.startsWith("Chapter") && b.startsWith("Chapter")) return a.localeCompare(b, undefined, { numeric: true });
    if (a === "Codex & Reference") return 1;
    if (b === "Codex & Reference") return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Short label for a quick-open alternative chip.
function chipLabel(d: ParsedDoc): string {
  if (d.chapter != null) {
    if (d.typeCode === "P") return `Draft ${d.draftPart ?? ""}`.trim();
    return d.typeLabel;
  }
  return d.title.length > 28 ? `${d.title.slice(0, 27)}…` : d.title;
}

interface ChapterRow { chapter: number; title: string; A?: ParsedDoc; B?: ParsedDoc; R?: ParsedDoc; P: ParsedDoc[]; }

export function ProjectExplorer({ onBack }: { onBack: () => void }) {
  const [docs, setDocs] = useState<ParsedDoc[]>([]);
  const [view, setView] = useState<View>("files");
  const [mode, setMode] = useState<GroupMode>("chapter");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ParsedDoc | null>(null);
  const [content, setContent] = useState("");
  const [contentHtml, setContentHtml] = useState<string | null>(null);
  const [contentBusy, setContentBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [error, setError] = useState("");
  const [command, setCommand] = useState("");
  const [quick, setQuick] = useState<{ interpretation: string; candidates: ParsedDoc[]; miss: boolean } | null>(null);
  const commandRef = useRef<HTMLInputElement>(null);
  const [brain, setBrain] = useState<StoryBrain | null>(null);
  const [brainNote, setBrainNote] = useState("");
  const [brainFilter, setBrainFilter] = useState("");

  useEffect(() => {
    void (async () => {
      const list = await invoke<ProjectDocument[]>("list_project_documents");
      const wordFiles = await invoke<string[]>("list_workspace_docx").catch(() => [] as string[]);
      for (const relative of wordFiles) {
        list.push({ dropboxPath: `local:${relative}`, localRelativePath: relative, revisionId: null, byteCount: 0, status: "downloaded" });
      }
      setDocs(list.map(parseDoc));
    })().catch(() => setError("The local files could not be listed. Download the project first."));
  }, []);

  const downloaded = docs.filter((parsed) => parsed.doc.status === "downloaded");
  const pending = docs.filter((parsed) => parsed.doc.status !== "downloaded");

  const byName = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? downloaded.filter((parsed) => parsed.fileName.toLowerCase().includes(query) || parsed.title.toLowerCase().includes(query)) : downloaded;
  }, [downloaded, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, ParsedDoc[]>();
    for (const parsed of byName) {
      const key = groupKey(parsed, mode);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(parsed);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.chapter != null && b.chapter != null && a.chapter !== b.chapter) return a.chapter - b.chapter;
        const ta = TYPE_ORDER.indexOf(a.typeLabel), tb = TYPE_ORDER.indexOf(b.typeLabel);
        if (ta !== tb) return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb);
        return (a.draftPart ?? 0) - (b.draftPart ?? 0) || a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
      });
    }
    return sortGroups(mode, [...map.keys()]).map((key) => [key, map.get(key)!] as const);
  }, [byName, mode]);

  const chapters = useMemo(() => {
    const map = new Map<number, ChapterRow>();
    for (const parsed of downloaded) {
      if (parsed.chapter == null) continue;
      if (!map.has(parsed.chapter)) map.set(parsed.chapter, { chapter: parsed.chapter, title: `Chapter ${parsed.chapter}`, P: [] });
      const row = map.get(parsed.chapter)!;
      if (parsed.typeCode === "A") { row.A = parsed; row.title = parsed.title; }
      else if (parsed.typeCode === "B") row.B = parsed;
      else if (parsed.typeCode === "R") { row.R = parsed; if (row.title.startsWith("Chapter")) row.title = parsed.title; }
      else if (parsed.typeCode === "P") row.P.push(parsed);
    }
    for (const row of map.values()) row.P.sort((a, b) => (a.draftPart ?? 0) - (b.draftPart ?? 0));
    return [...map.values()].sort((a, b) => a.chapter - b.chapter);
  }, [downloaded]);

  // The Story Brain is built from the ID Registry codex — the project's own
  // catalog of everyone and everything. Loaded on demand, once.
  const registryDoc = useMemo(() => {
    return downloaded
      .filter((parsed) => parsed.typeCode === "codex" && /ID Registry/i.test(parsed.title))
      .sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
  }, [downloaded]);

  useEffect(() => {
    if (view !== "codex" || brain || !registryDoc) return;
    let cancelled = false;
    void invoke<string>("read_project_document", { localRelativePath: registryDoc.doc.localRelativePath })
      .then((text) => { if (!cancelled) { setBrain(parseRegistry(text)); setBrainNote(""); } })
      .catch(() => { if (!cancelled) setBrainNote("The ID Registry could not be read from the local workspace."); });
    return () => { cancelled = true; };
  }, [view, brain, registryDoc]);

  // Find a character/place profile file for an entity, when one exists.
  function profileFor(entity: RegistryEntity): ParsedDoc | undefined {
    const term = entity.searchTerm.toLowerCase();
    return downloaded.find((parsed) =>
      parsed.typeCode === "codex" &&
      /profiles/i.test(parsed.fileName) &&
      (parsed.title.toLowerCase().includes(term) ||
        entity.aliases.some((alias) => parsed.title.toLowerCase().includes(alias.toLowerCase()))));
  }

  async function openDoc(parsed: ParsedDoc) {
    setSelected(parsed);
    setHits(null);
    setContentBusy(true);
    setContentHtml(null);
    try {
      if (/\.docx$/i.test(parsed.fileName)) {
        const bytes = await invoke<number[]>("read_project_document_bytes", { localRelativePath: parsed.doc.localRelativePath });
        const buffer = new Uint8Array(bytes).buffer;
        const mammoth = await import("mammoth/mammoth.browser");
        setContent((await mammoth.extractRawText({ arrayBuffer: buffer })).value.trim());
        setContentHtml((await mammoth.convertToHtml({ arrayBuffer: buffer })).value);
      } else {
        setContent(await invoke<string>("read_project_document", { localRelativePath: parsed.doc.localRelativePath }));
      }
    } catch {
      setContent("This file could not be opened from the local workspace.");
    } finally {
      setContentBusy(false);
    }
  }

  // Reads whatever text is highlighted in the viewer out loud with the same
  // voice as Reader Mode. Reading nothing highlighted reads nothing.
  const voice = useRef(new BrowserSpeechPlayer());
  useEffect(() => () => voice.current.stop(), []);
  const [speaking, setSpeaking] = useState(false);
  function readSelection() {
    if (speaking) { voice.current.stop(); setSpeaking(false); return; }
    const text = window.getSelection()?.toString().trim();
    if (!text) return;
    setSpeaking(true);
    voice.current.speak(text.slice(0, 4000), 1, () => setSpeaking(false), () => setSpeaking(false));
  }

  // Word files are sealed packages, so their text is pulled out once and kept
  // in memory; after that, searching them costs nothing extra.
  const docxTextCache = useRef(new Map<string, string>());
  async function docxText(relative: string): Promise<string> {
    const cached = docxTextCache.current.get(relative);
    if (cached !== undefined) return cached;
    try {
      const bytes = await invoke<number[]>("read_project_document_bytes", { localRelativePath: relative });
      const mammoth = await import("mammoth/mammoth.browser");
      const text = (await mammoth.extractRawText({ arrayBuffer: new Uint8Array(bytes).buffer })).value;
      docxTextCache.current.set(relative, text);
      return text;
    } catch {
      docxTextCache.current.set(relative, "");
      return "";
    }
  }

  async function runSearch(query?: string) {
    const value = (query ?? searchQuery).trim();
    if (query !== undefined) setSearchQuery(query);
    if (!value) { setHits(null); return; }
    setSearchBusy(true);
    setSelected(null);
    try {
      const textHits = await invoke<SearchHit[]>("search_project_documents", { query: value });
      const needle = value.toLowerCase();
      const wordDocs = docs.filter((parsed) => /\.docx$/i.test(parsed.fileName) && parsed.doc.status === "downloaded");
      for (const parsed of wordDocs) {
        const text = await docxText(parsed.doc.localRelativePath);
        const count = text.toLowerCase().split(needle).length - 1;
        if (!count) continue;
        const line = text.split(/[\r\n]+/).find((candidate) => candidate.toLowerCase().includes(needle)) ?? "";
        textHits.push({ localRelativePath: parsed.doc.localRelativePath, matchCount: count, snippet: line.trim().slice(0, 140) });
      }
      textHits.sort((left, right) => right.matchCount - left.matchCount);
      setHits(textHits);
    } catch {
      setHits([]);
    } finally {
      setSearchBusy(false);
    }
  }

  // "Just say it" — resolve a natural phrase to one file and open it instantly.
  function runCommand(phrase?: string) {
    const value = (phrase ?? command).trim();
    if (phrase !== undefined) setCommand(phrase);
    if (!value) { setQuick(null); return; }
    const result = resolveQuickOpen(value, downloaded);
    if (result.best) {
      void openDoc(result.best);
      setQuick({ interpretation: result.interpretation, candidates: result.candidates, miss: false });
    } else {
      setQuick({ interpretation: "", candidates: [], miss: true });
    }
  }

  // Ctrl/Cmd+K jumps straight to the command bar, wherever you are.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        commandRef.current?.focus();
        commandRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const docFor = (relative: string) => docs.find((parsed) => parsed.doc.localRelativePath === relative);

  const statusCell = (label: string, doc?: ParsedDoc, extra?: string) => doc
    ? <button className="status-cell has" onClick={() => void openDoc(doc)} title={`Open ${doc.fileName}`}>{label}{extra ? <em>{extra}</em> : null}{doc.version && <span>v{doc.version}</span>}</button>
    : <span className="status-cell missing">{label}<em>—</em></span>;

  return <main className="app-shell explorer-shell">
    <header className="topbar">
      <button className="text-button" onClick={onBack}>← The Long Rot</button>
      <span className="eyebrow">PROJECT FILES</span>
      <span>{downloaded.length} files{pending.length ? ` · ${pending.length} pending` : ""}</span>
    </header>

    <div className="quick-open">
      <span className="quick-open-mark" aria-hidden="true">▸</span>
      <input
        ref={commandRef}
        value={command}
        placeholder="Say what to open — “Silas”, “chapter 2”, “ch 2 reader”, “master codex”  (Ctrl+K)"
        onChange={(event) => setCommand(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") runCommand(); }}
      />
      <button className="primary" onClick={() => runCommand()}>Open</button>
      {quick && (
        <div className="quick-open-result">
          {quick.miss
            ? <span className="quick-miss">Couldn't place that. Try a chapter number, a stage, or a name.</span>
            : <>
                <span className="quick-open-label">Opened <strong>{quick.interpretation}</strong></span>
                {quick.candidates.length > 1 && <span className="quick-open-also">also:</span>}
                {quick.candidates.slice(0, 6).map((c) => (
                  <button
                    key={c.doc.localRelativePath}
                    className={`quick-chip type-${c.typeCode}` + (selected?.doc.localRelativePath === c.doc.localRelativePath ? " current" : "")}
                    title={c.fileName}
                    onClick={() => { void openDoc(c); setQuick((q) => q ? { ...q, interpretation: describeDoc(c) } : q); }}
                  >{chipLabel(c)}</button>
                ))}
              </>}
        </div>
      )}
    </div>

    <nav className="explorer-tabs">
      <button className={view === "files" ? "active" : ""} onClick={() => setView("files")}>Files</button>
      <button className={view === "chapters" ? "active" : ""} onClick={() => setView("chapters")}>Chapters</button>
      <button className={view === "codex" ? "active" : ""} onClick={() => setView("codex")}>Codex</button>
      <div className="ask-anything">
        <input
          value={searchQuery}
          placeholder="Ask anything — a character, place, word (e.g. Silas, Warden)"
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void runSearch(); }}
        />
        <button className="primary" onClick={() => void runSearch()} disabled={searchBusy}>{searchBusy ? "…" : "Find"}</button>
        {hits !== null && <button className="text-button" onClick={() => setHits(null)}>Clear</button>}
      </div>
    </nav>

    {error && <p className="explorer-error">{error}</p>}

    <section className="explorer-body">
      <div className="explorer-list">
        {view === "files" && <>
          <div className="group-toggle">
            <span>Group by</span>
            <button className={mode === "chapter" ? "active" : ""} onClick={() => setMode("chapter")}>Chapter</button>
            <button className={mode === "type" ? "active" : ""} onClick={() => setMode("type")}>Stage</button>
            <button className={mode === "folder" ? "active" : ""} onClick={() => setMode("folder")}>Folder</button>
          </div>
          <input className="list-filter" value={filter} placeholder="Filter this list by name…" onChange={(event) => setFilter(event.target.value)} />
          {groups.map(([key, list]) => <div key={key} className="explorer-group">
            <h3>{key} <span>{list.length}</span></h3>
            <ul>
              {list.map((parsed) => <li key={parsed.doc.localRelativePath}>
                <button className={selected?.doc.localRelativePath === parsed.doc.localRelativePath ? "selected" : ""} onClick={() => void openDoc(parsed)}>
                  <span className={`type-chip type-${parsed.typeCode}`}>{parsed.typeCode === "P" ? `P${parsed.draftPart ?? ""}` : parsed.typeLabel}</span>
                  <span className="doc-title">{parsed.title}</span>
                  {parsed.version && <span className="doc-version">v{parsed.version}</span>}
                </button>
              </li>)}
            </ul>
          </div>)}
          {groups.length === 0 && <p className="explorer-empty">No downloaded files yet.</p>}
        </>}

        {view === "chapters" && <div className="status-board">
          <p className="board-hint">Every chapter needs Blueprint · Development · Draft · Reader Copy. Click a filled box to open it.</p>
          {chapters.map((row) => <div key={row.chapter} className="status-row">
            <div className="status-name"><strong>Ch {String(row.chapter).padStart(2, "0")}</strong><small>{row.title.startsWith("Chapter") ? "Untitled" : row.title}</small></div>
            <div className="status-cells">
              {statusCell("Blueprint", row.A)}
              {statusCell("Development", row.B)}
              {row.P.length ? <button className="status-cell has" onClick={() => void openDoc(row.P[0])} title="Open first draft part">Draft<em>{row.P.length} part{row.P.length === 1 ? "" : "s"}</em></button> : <span className="status-cell missing">Draft<em>—</em></span>}
              {statusCell("Reader Copy", row.R)}
            </div>
          </div>)}
          {chapters.length === 0 && <p className="explorer-empty">No chapter files downloaded yet.</p>}
        </div>}

        {view === "codex" && <div className="bible-list">
          {brainNote && <p className="explorer-error">{brainNote}</p>}
          {!registryDoc && <p className="explorer-empty">Download the project to build the Story Brain from your ID Registry.</p>}
          {registryDoc && !brain && !brainNote && <p className="explorer-empty">Reading the ID Registry…</p>}
          {brain && <>
            <div className="brain-head">
              <p className="board-hint">Everyone and everything in your world, straight from the ID Registry. Click any entry to find every file it appears in.</p>
              <span className="brain-headline">{brainHeadline(brain)}</span>
              <input className="list-filter" value={brainFilter} placeholder="Filter people, places, objects…" onChange={(event) => setBrainFilter(event.target.value)} />
            </div>
            {brain.categories.map((cat) => {
              const q = brainFilter.trim().toLowerCase();
              const list = q
                ? cat.entities.filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q)))
                : cat.entities;
              if (!list.length) return null;
              return <div key={cat.key} className="brain-group">
                <h3>{cat.label} <span>{list.length}</span></h3>
                <ul>
                  {list.map((entity) => {
                    const profile = profileFor(entity);
                    return <li key={entity.id} className={`brain-entity kind-${entity.kind}`}>
                      <button className="brain-find" onClick={() => void runSearch(entity.searchTerm)} title={`Find “${entity.searchTerm}” across every file`}>
                        <span className="entity-id">{entity.id}</span>
                        <span className="entity-name">{entity.name}</span>
                        <span className="entity-go">appearances →</span>
                      </button>
                      {profile && <button className="entity-profile" title="Open profile file" onClick={() => void openDoc(profile)}>Profile</button>}
                    </li>;
                  })}
                </ul>
              </div>;
            })}
          </>}
        </div>}
      </div>

      <div className="explorer-view">
        {hits !== null ? <div className="search-results">
          <h2>{hits.length ? `“${searchQuery}” — found in ${hits.length} file${hits.length === 1 ? "" : "s"}` : `No files mention “${searchQuery}”`}</h2>
          <ul>
            {hits.map((hit) => {
              const parsed = docFor(hit.localRelativePath);
              return <li key={hit.localRelativePath}>
                <button onClick={() => parsed && void openDoc(parsed)}>
                  <strong>{parsed ? parsed.title : hit.localRelativePath}</strong>
                  <span className="hit-count">{hit.matchCount}×</span>
                  <em>{hit.snippet}</em>
                </button>
              </li>;
            })}
          </ul>
        </div> : selected ? <div className="doc-viewer">
          <div className="doc-viewer-head">
            <div><strong>{selected.title}</strong><small>{selected.fileName}</small></div>
            <span className="doc-version">{!contentBusy && `${wordCount(content).toLocaleString()} words`}{selected.version ? ` · v${selected.version}` : ""}</span>
            <button className="text-button" onClick={readSelection} title="Highlight some text first, then press this to hear it">{speaking ? "■ Stop reading" : "🔊 Read highlighted"}</button>
          </div>
          {contentHtml
            ? <div className="doc-word" dangerouslySetInnerHTML={{ __html: contentHtml }} />
            : <pre>{contentBusy ? "Opening…" : content}</pre>}
        </div> : <div className="explorer-hint">
          <h2>Your project, organized</h2>
          <p>Pick a file to read it, browse <strong>Chapters</strong> to see what's done, open the <strong>Codex</strong> for characters and places, or use <strong>Ask anything</strong> to find every mention of something — no AI needed.</p>
        </div>}
      </div>
    </section>
  </main>;
}
