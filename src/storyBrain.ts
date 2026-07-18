// Story Brain — turns the project's ID Registry codex into a browsable catalog
// of the world: people, entities, locations, objects. Pure text parsing, no AI
// and no network, so the app's "bible" always matches canon exactly.

export type EntityKind = "person" | "entity" | "location" | "object" | "rule" | "document" | "other";

export interface RegistryEntity {
  id: string;        // e.g. "DC-001"
  prefix: string;    // e.g. "DC"
  number: number;    // e.g. 1
  name: string;      // canonical display name, e.g. 'Louvenia "Vina" Reed'
  aliases: string[]; // every name/nickname worth recognising
  searchTerm: string;// the most distinctive term to hunt appearances by
  category: string;  // registry's own label, e.g. "Direct Carriers"
  kind: EntityKind;
}

export interface BrainCategory {
  key: string;       // prefix, e.g. "LO"
  label: string;     // e.g. "Locations"
  kind: EntityKind;
  entities: RegistryEntity[];
}

export interface StoryBrain {
  categories: BrainCategory[];
  entities: RegistryEntity[];
}

const KIND_BY_PREFIX: Record<string, EntityKind> = {
  DC: "person", CB: "person", CH: "person",
  EN: "entity", LO: "location", OB: "object",
  RU: "rule", DOC: "document"
};

// Categories the browsable bible shows, in this order. Documents and rules are
// handled by other views, so they are parsed but not surfaced here.
const DISPLAY_PREFIXES = ["DC", "CB", "CH", "EN", "LO", "OB"];

const TITLES = /^(?:Dr|Mr|Mrs|Ms|Sgt|Capt|Col|Gen|Pvt)\.?\s+|^(?:Corporal|Sergeant|Captain|Colonel|General|Private|Deputy|Sheriff|Agent|Reverend|Judge)\s+/i;

const ENTITY_LINE = /^([A-Z]{2,3})-(\d+)\s+[—–-]\s+(.+?)\s*$/;
const PREFIX_LINE = /^([A-Z]{2,3})\s+[—–-]\s+([A-Za-z].+?)\s*$/;

// Choose the single most useful term to search prose for this entity.
function distinctiveTerm(name: string, kind: EntityKind): string {
  const nick = name.match(/"([^"]+)"|“([^”]+)”/);
  if (nick) return (nick[1] ?? nick[2]).trim();

  let base = name.split(/\s*\/\s*/)[0];               // first of "A / B" aliases
  base = base.replace(/"[^"]*"|“[^”]*”/g, " ").replace(/\s+/g, " ").trim();
  base = base.replace(TITLES, "").trim();

  if (kind === "person") return base.split(/\s+/)[0] || base;
  if (kind === "location" || kind === "entity") return base.replace(/^The\s+/i, "").trim();
  if (kind === "object") return base.split(",")[0].trim();
  return base;
}

function buildAliases(name: string): string[] {
  const out = new Set<string>();
  for (const part of name.split(/\s*\/\s*/)) {
    const clean = part.replace(/\s+/g, " ").trim();
    if (clean) out.add(clean.replace(/"[^"]*"|“[^”]*”/g, "").replace(/\s+/g, " ").trim());
  }
  for (const m of name.matchAll(/"([^"]+)"|“([^”]+)”/g)) {
    const nick = (m[1] ?? m[2]).trim();
    if (nick) out.add(nick);
  }
  return [...out].filter(Boolean);
}

export function parseRegistry(text: string): StoryBrain {
  const lines = text.split(/\r?\n/);

  // First pass: the "IDENTIFIER PREFIXES" legend gives each prefix its label
  // and order. Fall back to sensible defaults if the legend is ever missing.
  const labels = new Map<string, string>();
  const order: string[] = [];
  const defaults: Record<string, string> = {
    DC: "Direct Carriers", CB: "Crane Blood", CH: "Characters",
    EN: "Entities", LO: "Locations", OB: "Objects", RU: "Rules", DOC: "Documents"
  };
  for (const line of lines) {
    const m = line.match(PREFIX_LINE);
    if (m && KIND_BY_PREFIX[m[1]] && !labels.has(m[1])) {
      labels.set(m[1], m[2].trim());
      order.push(m[1]);
    }
  }
  for (const [p, label] of Object.entries(defaults)) if (!labels.has(p)) labels.set(p, label);
  for (const p of DISPLAY_PREFIXES) if (!order.includes(p)) order.push(p);

  // Second pass: every real entity line. De-duplicate by id (registry is clean,
  // but guard against a repeated line).
  const byId = new Map<string, RegistryEntity>();
  for (const line of lines) {
    const m = line.match(ENTITY_LINE);
    if (!m) continue;
    const prefix = m[1];
    const kind = KIND_BY_PREFIX[prefix];
    if (!kind) continue;
    const id = `${prefix}-${m[2]}`;
    if (byId.has(id)) continue;
    const rawName = m[3].trim();
    // Documents carry trailing "— filename — Active"; keep only up to the first dash group.
    const name = kind === "document" ? rawName.split(/\s+[—–-]\s+/)[0].trim() : rawName;
    byId.set(id, {
      id, prefix, number: parseInt(m[2], 10),
      name,
      aliases: buildAliases(name),
      searchTerm: distinctiveTerm(name, kind),
      category: labels.get(prefix) ?? prefix,
      kind
    });
  }

  const entities = [...byId.values()];
  const categories: BrainCategory[] = order
    .filter((p) => DISPLAY_PREFIXES.includes(p))
    .map((p) => ({
      key: p,
      label: labels.get(p) ?? p,
      kind: KIND_BY_PREFIX[p] ?? "other",
      entities: entities.filter((e) => e.prefix === p).sort((a, b) => a.number - b.number)
    }))
    .filter((c) => c.entities.length > 0);

  return { categories, entities };
}

// A one-line summary such as "6 carriers · 17 characters · 9 locations".
// Pure: the canon entities whose names appear in a piece of text — the raw
// material for a story-context block the Voice Companion sends to the AI.
export function entitiesMentioned(brain: StoryBrain, text: string, limit = 6): RegistryEntity[] {
  const lower = ` ${text.toLowerCase()} `;
  const found: RegistryEntity[] = [];
  for (const entity of brain.entities) {
    if (found.length >= limit) break;
    if (entity.kind === "rule" || entity.kind === "document") continue;
    const names = [entity.name, ...entity.aliases, entity.searchTerm].filter((n) => n && n.length >= 3);
    if (names.some((name) => lower.includes(` ${name.toLowerCase()} `) || lower.includes(` ${name.toLowerCase()},`) || lower.includes(` ${name.toLowerCase()}.`))) {
      found.push(entity);
    }
  }
  return found;
}

export function storyContextBlock(entities: RegistryEntity[]): string {
  if (!entities.length) return "";
  const lines = entities.map((e) => `- ${e.name} (${e.id}, ${e.category})`);
  return `[Story context — canon identities for names mentioned:\n${lines.join("\n")}\nUse the codex files for details; do not invent conflicting facts.]\n\n`;
}

export function brainHeadline(brain: StoryBrain): string {
  const people = brain.entities.filter((e) => e.kind === "person").length;
  const places = brain.entities.filter((e) => e.kind === "location").length;
  const things = brain.entities.filter((e) => e.kind === "object").length;
  const forces = brain.entities.filter((e) => e.kind === "entity").length;
  const bits = [
    people ? `${people} people` : "",
    forces ? `${forces} forces` : "",
    places ? `${places} locations` : "",
    things ? `${things} objects` : ""
  ].filter(Boolean);
  return bits.join(" · ");
}
