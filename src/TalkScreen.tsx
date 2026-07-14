import { useEffect, useRef, useState } from "react";
import { CommentRecorder } from "./recorder";
import { hasOpenAiKey, requestAnswer, saveOpenAiKey, speakAnswer, transcribeAudio, type ConversationTurn } from "./openai";

type TalkState = "checking" | "setup" | "idle" | "recording" | "review" | "thinking" | "answer";

export function TalkScreen({ readerName, onBack }: { readerName: string; onBack: () => void }) {
  const [state, setState] = useState<TalkState>("checking");
  const [apiKey, setApiKey] = useState("");
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("Checking secure AI setup…");
  const [turns, setTurns] = useState<ConversationTurn[]>(() => {
    try { return JSON.parse(localStorage.getItem("long-rot-conversation") || "[]"); } catch { return []; }
  });
  const recorder = useRef(new CommentRecorder());
  const recording = useRef<Blob | null>(null);
  const spokenAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void hasOpenAiKey().then((configured) => {
      setState(configured ? "idle" : "setup");
      setStatus(configured ? "Ready to talk" : "Add an OpenAI API key to enable voice conversation");
    });
    return () => { recorder.current.cancel(); spokenAudio.current?.pause(); };
  }, []);

  async function configureKey() {
    setStatus("Saving securely with Windows…");
    try {
      await saveOpenAiKey(apiKey);
      setApiKey("");
      setState("idle");
      setStatus("AI connection configured on this computer. OpenAI-generated voices are artificial.");
    } catch (error) { setStatus(message(error)); }
  }

  async function startTalking() {
    spokenAudio.current?.pause();
    recording.current = null;
    setTranscript("");
    setAnswer("");
    try {
      await recorder.current.start(() => {}, setTranscript);
      setState("recording");
      setStatus("Listening — press Finish when you are done");
    } catch (error) { setStatus(message(error)); }
  }

  async function finishTalking() {
    setStatus("Saving recording…");
    try {
      const result = await recorder.current.stop();
      recording.current = result.audio;
      setState("review");
      setStatus("Transcribing…");
      try {
        const cloudTranscript = await transcribeAudio(result.audio);
        setTranscript(cloudTranscript);
        setStatus("Check the transcription, then send it");
      } catch (error) {
        setTranscript(result.transcription || transcript);
        setStatus(`${message(error)} You can correct or type the request below.`);
      }
    } catch (error) { setState("review"); setStatus(message(error)); }
  }

  async function sendRequest() {
    const request = transcript.trim();
    if (!request) { setStatus("Please say or type a request first."); return; }
    setState("thinking");
    setStatus("Thinking…");
    try {
      const response = await requestAnswer(request, turns);
      const updated: ConversationTurn[] = [
        ...turns,
        { role: "user" as const, text: request, createdAt: new Date().toISOString() },
        { role: "assistant" as const, text: response, createdAt: new Date().toISOString() }
      ].slice(-20);
      setTurns(updated);
      localStorage.setItem("long-rot-conversation", JSON.stringify(updated));
      setAnswer(response);
      setState("answer");
      setStatus("Answer ready — speaking aloud");
      try { spokenAudio.current = await speakAnswer(response); }
      catch (error) { setStatus(`${message(error)} The written answer is available.`); }
    } catch (error) { setState("review"); setStatus(message(error)); }
  }

  async function repeatAnswer() {
    if (!answer) return;
    spokenAudio.current?.pause();
    try { spokenAudio.current = await speakAnswer(answer); setStatus("Speaking answer"); }
    catch (error) { setStatus(message(error)); }
  }

  function stopSpeaking() {
    spokenAudio.current?.pause();
    setStatus("Speech stopped — written answer remains available");
  }

  return <main className="app-shell talk-shell">
    <header className="topbar"><button className="text-button" onClick={onBack}>← Main menu</button><span className="eyebrow">TALK ABOUT THE BOOK</span><span>{readerName}</span></header>
    {state === "setup" && <section className="talk-setup"><h1>Connect the AI</h1><p>Enter an OpenAI API key. Windows stores it in Credential Manager; it is not saved in project files or browser storage.</p><label>OpenAI API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" placeholder="sk-…" /></label><button disabled={!apiKey.trim()} onClick={configureKey}>Save securely</button></section>}
    {state !== "setup" && <>
      <section className="talk-heading"><p className="eyebrow">VOICE PROJECT ASSISTANT</p><h1>{state === "recording" ? "I’m listening." : state === "thinking" ? "Thinking…" : state === "answer" ? "Here’s what I found." : "What would you like to discuss?"}</h1><p>Speak naturally about characters, chapters, ideas, or decisions.</p></section>
      {state === "idle" && <button className="talk-button" onClick={startTalking}><span>●</span> Start Talking</button>}
      {state === "recording" && <section className="talk-recording"><div className="recording-pulse" /><p>{transcript || "Speak now…"}</p><button onClick={finishTalking}>Finish</button></section>}
      {state === "review" && <section className="talk-review"><label>Your request<textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} rows={5} /></label><div><button onClick={startTalking}>Start Over</button><button className="send-talk" onClick={sendRequest}>Send</button></div></section>}
      {state === "thinking" && <div className="thinking-card"><div className="recording-pulse" /><p>Working on your answer…</p></div>}
      {state === "answer" && <section className="answer-card"><p>{answer}</p><div><button onClick={stopSpeaking}>Stop Speaking</button><button onClick={repeatAnswer}>Repeat Answer</button><button className="send-talk" onClick={() => { setState("idle"); setTranscript(""); setAnswer(""); }}>Ask Another</button></div></section>}
      {turns.length > 0 && state === "idle" && <section className="recent-conversation"><h2>Recent conversation</h2>{turns.slice(-4).map((turn, index) => <p key={`${turn.createdAt}-${index}`}><strong>{turn.role === "user" ? readerName : "Assistant"}:</strong> {turn.text}</p>)}</section>}
    </>}
    <footer className="safe-status">{status}</footer>
  </main>;
}

function message(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : "That operation could not be completed.";
}
