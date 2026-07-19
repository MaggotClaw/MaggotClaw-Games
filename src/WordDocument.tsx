// A Word document shown as the author actually wrote it.
//
// Mammoth is still used elsewhere, and rightly: it strips a document down to
// plain words, which is what narration and the AI need. But it throws away
// fonts, sizes, colours and spacing on purpose, so a chapter styled in Word
// arrives wearing the app's clothes instead of its own — and a header made by
// hand rather than with Word's Heading style vanishes altogether.
//
// This renders the file itself, so what the author sees is what he wrote.

import { useEffect, useRef, useState } from "react";

export function WordDocument({ localRelativePath }: { localRelativePath: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let cancelled = false;
    const container = host.current;
    if (!container) return;
    setProblem("");
    container.replaceChildren();

    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = await invoke<number[]>("read_project_document_bytes", { localRelativePath });
        // The screen may have moved on while the file was being read.
        if (cancelled || !host.current) return;
        const { renderAsync } = await import("docx-preview");
        await renderAsync(new Uint8Array(bytes), host.current, undefined, {
          className: "docx",
          inWrapper: true,
          // The document brings its own look; nothing here should second-guess it.
          ignoreWidth: false,
          ignoreHeight: true,
          ignoreFonts: false,
          breakPages: true,
          useBase64URL: true
        });
      } catch {
        if (!cancelled) setProblem("This chapter could not be shown with its Word formatting. Switch to Narrated to read it.");
      }
    })();

    return () => { cancelled = true; };
  }, [localRelativePath]);

  return <>
    {problem && <p className="update-status warn">{problem}</p>}
    <div className="word-page" ref={host} />
  </>;
}
