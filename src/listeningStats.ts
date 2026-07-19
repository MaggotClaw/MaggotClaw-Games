// Quiet listening stats: hours listened, chapters finished, and a day streak.
// Private to each reader, never shared, never competitive — just a sense of
// momentum through a long book.

export interface ListeningStats {
  secondsListened: number;
  chaptersFinished: number;
  streakDays: number;
  lastDay: string;          // YYYY-MM-DD of the most recent listening day
}

const key = (profile: string) => `mcg-listening:${profile || "local"}`;

const EMPTY: ListeningStats = { secondsListened: 0, chaptersFinished: 0, streakDays: 0, lastDay: "" };

export function loadListeningStats(profile: string): ListeningStats {
  try {
    return { ...EMPTY, ...(JSON.parse(localStorage.getItem(key(profile)) || "{}") as Partial<ListeningStats>) };
  } catch {
    return { ...EMPTY };
  }
}

function save(profile: string, stats: ListeningStats): void {
  try { localStorage.setItem(key(profile), JSON.stringify(stats)); } catch { /* ignore */ }
}

// Pure: fold listening time into the stats, keeping the day streak honest.
export function withListening(stats: ListeningStats, seconds: number, today: string): ListeningStats {
  let streakDays = stats.streakDays;
  if (stats.lastDay !== today) {
    const yesterday = new Date(new Date(`${today}T12:00:00`).getTime() - 86400000).toISOString().slice(0, 10);
    streakDays = stats.lastDay === yesterday ? stats.streakDays + 1 : 1;
  }
  return { ...stats, secondsListened: stats.secondsListened + seconds, streakDays, lastDay: today };
}

export function addListeningSeconds(profile: string, seconds: number): void {
  const today = new Date().toISOString().slice(0, 10);
  save(profile, withListening(loadListeningStats(profile), seconds, today));
}

export function recordChapterFinished(profile: string): void {
  const stats = loadListeningStats(profile);
  save(profile, { ...stats, chaptersFinished: stats.chaptersFinished + 1 });
}

export function listeningLine(stats: ListeningStats): string {
  if (!stats.secondsListened && !stats.chaptersFinished) return "";
  const hours = stats.secondsListened / 3600;
  // "1 Minutes" reads like a machine wrote it. One of anything gets its own
  // word, and a flat 1.0 hours is simply "1 Hour".
  const minutes = Math.max(1, Math.round(stats.secondsListened / 60));
  const listened = hours >= 1
    ? `${hours.toFixed(1).replace(/\.0$/, "")} Hour${hours.toFixed(1) === "1.0" ? "" : "s"} Listened`
    : `${minutes} Minute${minutes === 1 ? "" : "s"} Listened`;
  const parts = [listened];
  if (stats.chaptersFinished) parts.push(`${stats.chaptersFinished} Chapter${stats.chaptersFinished === 1 ? "" : "s"} Finished`);
  if (stats.streakDays > 1) parts.push(`${stats.streakDays}-Day Streak`);
  return parts.join(" · ");
}
