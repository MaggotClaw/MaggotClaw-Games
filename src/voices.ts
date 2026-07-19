// More voices, fetched only when someone wants one.
//
// Bundling them was the alternative, and it would have added a few hundred
// megabytes to an installer every friend has to download — most of them to
// carry voices nobody chose. These come from the Piper project's own release
// files, are fetched once, and then work offline forever.

export interface Voice {
  file: string;              // the model file name, and how a choice is stored
  name: string;
  accent: string;
  note: string;
  megabytes: number;
  bundled?: boolean;
}

// Piper publishes its voices on Hugging Face under an open licence. "high"
// models sound best and cost the most to fetch; "medium" is the honest
// middle for a voice someone will listen to for hours.
const PIPER = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en";

export const VOICES: Voice[] = [
  { file: "en_GB-cori-high.onnx", name: "Cori", accent: "British", note: "The voice that comes with the app.", megabytes: 0, bundled: true },
  { file: "en_GB-alba-medium.onnx", name: "Alba", accent: "Scottish", note: "Warmer and slower. Suits being read to at length.", megabytes: 63 },
  { file: "en_GB-northern_english_male-medium.onnx", name: "Northern", accent: "Northern English", note: "A man's voice, plain and unhurried.", megabytes: 63 },
  { file: "en_US-lessac-high.onnx", name: "Lessac", accent: "American", note: "Clear and even. The easiest to follow at speed.", megabytes: 113 },
  { file: "en_US-ryan-high.onnx", name: "Ryan", accent: "American", note: "A man's voice with a little more weight to it.", megabytes: 113 }
];

// Pure: where a voice's two files live. Piper needs both — the model and its
// settings — and the settings file is always the model name plus .json.
export function voiceUrls(file: string): { model: string; config: string } | null {
  const voice = VOICES.find((item) => item.file === file);
  if (!voice || voice.bundled) return null;
  // en_GB-alba-medium.onnx  →  en_GB/alba/medium/en_GB-alba-medium.onnx
  const match = file.match(/^(en_[A-Z]{2})-(.+)-(low|medium|high)\.onnx$/);
  if (!match) return null;
  const [, locale, speaker, quality] = match;
  const base = `${PIPER}/${locale}/${speaker}/${quality}/${file}`;
  return { model: base, config: `${base}.json` };
}

export function voiceByFile(file: string): Voice | undefined {
  return VOICES.find((item) => item.file === file);
}

const CHOSEN_KEY = "mcg-voice-model";

export function chosenVoice(): string {
  try { return localStorage.getItem(CHOSEN_KEY) || VOICES[0].file; } catch { return VOICES[0].file; }
}

export function setChosenVoice(file: string): void {
  try { localStorage.setItem(CHOSEN_KEY, file); } catch { /* ignore */ }
}
