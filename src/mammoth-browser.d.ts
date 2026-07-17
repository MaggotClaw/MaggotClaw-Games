// Minimal typing for mammoth's browser build — we use exactly two calls.
declare module "mammoth/mammoth.browser" {
  interface MammothResult { value: string; messages: unknown[] }
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>;
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>;
}
