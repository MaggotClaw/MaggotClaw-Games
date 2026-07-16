export function deadlineAfterSpeech(currentDeadline: number, now: number, silenceSeconds: number): number {
  return Math.max(currentDeadline, now + silenceSeconds * 1000);
}
