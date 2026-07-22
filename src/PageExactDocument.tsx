// A chapter shown exactly as it was built in Word.
//
// docx-preview draws paragraphs well and shapes not at all: a filled header
// block, a text box, WordArt, 3D lettering — none of it survives, however the
// styling is tuned. So Word makes the picture itself, and this shows the pages
// it made.
//
// Everything scales to the width it is given, so narrowing the window shrinks
// the whole page rather than reflowing the words. The page keeps its shape at
// every size, which is the entire point.

import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { locateSentence, mergeRects, type PageTextBox } from "./pageHighlight";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// A whole chapter of full-size canvases is more memory than a reading app
// should hold, so only the pages near the reader are drawn. The rest keep
// their exact size as empty paper until they come near.
const DRAW_AHEAD = 1;
// Retina backing stores quadruple the memory for a difference nobody reading
// prose can see beyond this.
const MAX_SHARPNESS = 2;

interface PageShape {
  width: number;
  height: number;
}

export function PageExactDocument({
  localRelativePath,
  highlightSentence,
  onUnavailable
}: {
  localRelativePath: string;
  highlightSentence?: string;
  onUnavailable?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const doc = useRef<pdfjs.PDFDocumentProxy | null>(null);
  // Closing the file is the loading task's job, not the document's; holding
  // only the document leaks the worker behind it on every chapter change.
  const loader = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);
  const textCache = useRef(new Map<number, { items: { str: string }[]; boxes: PageTextBox[] }>());
  const [shapes, setShapes] = useState<PageShape[]>([]);
  const [scale, setScale] = useState(0);
  const [problem, setProblem] = useState("");
  const [marks, setMarks] = useState<{ page: number; rects: PageTextBox[] }>({ page: -1, rects: [] });

  // --- the file itself ------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setProblem("");
    setShapes([]);
    textCache.current.clear();
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = await invoke<number[]>("read_project_document_bytes", { localRelativePath });
        if (cancelled) return;
        const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
        const loaded = await task.promise;
        if (cancelled) { void task.destroy(); return; }
        loader.current = task;
        doc.current = loaded;
        const sizes: PageShape[] = [];
        for (let number = 1; number <= loaded.numPages; number += 1) {
          const view = (await loaded.getPage(number)).getViewport({ scale: 1 });
          sizes.push({ width: view.width, height: view.height });
        }
        if (!cancelled) setShapes(sizes);
      } catch {
        if (!cancelled) {
          setProblem("The page-exact copy of this chapter is not here yet.");
          onUnavailable?.();
        }
      }
    })();
    return () => {
      cancelled = true;
      void loader.current?.destroy();
      loader.current = null;
      doc.current = null;
    };
  }, [localRelativePath]);

  // --- fit to whatever width we are given -----------------------------------
  useEffect(() => {
    const container = host.current;
    if (!container || !shapes.length) return;
    const fit = () => {
      const available = container.clientWidth;
      if (available > 0) setScale(available / shapes[0].width);
    };
    fit();
    const watcher = new ResizeObserver(fit);
    watcher.observe(container);
    return () => watcher.disconnect();
  }, [shapes]);

  // --- draw the pages the reader can actually see ---------------------------
  useEffect(() => {
    const container = host.current;
    if (!container || !scale || !doc.current) return;
    const drawn = new Set<number>();
    const sharpness = Math.min(window.devicePixelRatio || 1, MAX_SHARPNESS);

    const draw = async (slot: HTMLElement) => {
      const number = Number(slot.dataset.page);
      if (!number || drawn.has(number) || !doc.current) return;
      drawn.add(number);
      try {
        const page = await doc.current.getPage(number);
        const view = page.getViewport({ scale });
        const canvas = slot.querySelector("canvas");
        if (!canvas) return;
        // Drawn at the screen's real pixel density, shown at the page's size.
        const crisp = page.getViewport({ scale: scale * sharpness });
        canvas.width = Math.floor(crisp.width);
        canvas.height = Math.floor(crisp.height);
        canvas.style.width = `${Math.floor(view.width)}px`;
        canvas.style.height = `${Math.floor(view.height)}px`;
        await page.render({ canvas, viewport: crisp }).promise;
        if (!textCache.current.has(number)) {
          const content = await page.getTextContent();
          const boxes = content.items.map((item) => {
            const entry = item as { transform: number[]; width: number };
            const placed = pdfjs.Util.transform(view.transform, entry.transform);
            const height = Math.hypot(placed[2], placed[3]);
            return { left: placed[4], top: placed[5] - height, width: entry.width * scale, height };
          });
          textCache.current.set(number, {
            items: content.items.map((item) => ({ str: (item as { str?: string }).str ?? "" })),
            boxes
          });
        }
      } catch {
        drawn.delete(number);
      }
    };

    const watcher = new IntersectionObserver(
      (entries) => entries.forEach((entry) => { if (entry.isIntersecting) void draw(entry.target as HTMLElement); }),
      { root: null, rootMargin: `${DRAW_AHEAD * 100}% 0px` }
    );
    container.querySelectorAll<HTMLElement>("[data-page]").forEach((slot) => watcher.observe(slot));
    return () => watcher.disconnect();
  }, [scale, shapes]);

  // --- follow the voice -----------------------------------------------------
  useEffect(() => {
    const sentence = highlightSentence?.trim();
    if (!sentence || !doc.current || !scale) { setMarks({ page: -1, rects: [] }); return; }
    let cancelled = false;
    void (async () => {
      // The page being read is nearly always the one already on screen, so
      // start from the last match rather than the top of the chapter.
      const total = doc.current?.numPages ?? 0;
      const order = [marks.page > 0 ? marks.page : 1];
      for (let number = 1; number <= total; number += 1) if (!order.includes(number)) order.push(number);
      for (const number of order) {
        if (cancelled || !doc.current) return;
        let entry = textCache.current.get(number);
        if (!entry) {
          try {
            const page = await doc.current.getPage(number);
            const content = await page.getTextContent();
            const view = page.getViewport({ scale });
            const boxes = content.items.map((item) => {
              const raw = item as { transform: number[]; width: number };
              const placed = pdfjs.Util.transform(view.transform, raw.transform);
              const height = Math.hypot(placed[2], placed[3]);
              return { left: placed[4], top: placed[5] - height, width: raw.width * scale, height };
            });
            entry = { items: content.items.map((item) => ({ str: (item as { str?: string }).str ?? "" })), boxes };
            textCache.current.set(number, entry);
          } catch {
            continue;
          }
        }
        const found = locateSentence(entry.items, sentence);
        if (found.length) {
          if (cancelled) return;
          const rects = mergeRects(entry.boxes, found);
          setMarks({ page: number, rects });
          host.current
            ?.querySelector<HTMLElement>(`[data-page="${number}"] .page-mark`)
            ?.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
      }
      // Not found anywhere — show the page clean rather than guess at it.
      if (!cancelled) setMarks({ page: -1, rects: [] });
    })();
    return () => { cancelled = true; };
  }, [highlightSentence, scale, shapes]);

  if (problem) return <p className="update-status warn">{problem}</p>;

  return <div className="page-exact" ref={host}>
    {!shapes.length && <p className="board-hint">Opening the chapter…</p>}
    {shapes.map((shape, index) => {
      const number = index + 1;
      const width = scale ? shape.width * scale : undefined;
      const height = scale ? shape.height * scale : undefined;
      return <div className="page-sheet" key={number} data-page={number} style={{ width, height }}>
        <canvas />
        {marks.page === number && marks.rects.map((rect, mark) =>
          <span className="page-mark" key={mark}
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />)}
      </div>;
    })}
  </div>;
}
