// Access-request queue. A Reader asks for more authority; the owner approves or
// denies. Authority is never self-assigned (per the Approval Workflow codex).
//
// Storage is local (this machine) for now. The pure functions below hold all the
// logic and are unit-tested; the thin load/save wrappers are the ONLY seam that
// changes when requests later travel through a shared Dropbox folder so the
// owner can see requests raised on other machines.

import { setProfileRole, type ProjectRole } from "./permissions";

export type RequestStatus = "pending" | "approved" | "denied";

export interface AccessRequest {
  id: string;
  name: string;            // the requesting profile
  currentRole: ProjectRole;
  requestedRole: ProjectRole;
  reason: string;
  status: RequestStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  dismissedAt?: string;    // set aside by the owner — still pending, just out of the queue
}

const STORAGE_KEY = "mcg-access-requests";

// ---- Pure core (no storage) ----------------------------------------------

// Add a request, replacing any earlier *pending* request from the same person so
// the queue never fills with duplicates while they wait.
export function addRequest(list: AccessRequest[], request: AccessRequest): AccessRequest[] {
  const kept = list.filter((r) => !(r.name === request.name && r.status === "pending"));
  return [request, ...kept];
}

export function pending(list: AccessRequest[]): AccessRequest[] {
  return list
    .filter((r) => r.status === "pending" && !r.dismissedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// The owner presses the X: not approved, not denied, nothing goes back to the
// person — the request just leaves the queue. Asking again makes a fresh
// request (addRequest drops the old pending one), so it returns undismissed.
export function dismissRequest(list: AccessRequest[], id: string, dismissedAt: string): AccessRequest[] {
  return list.map((r) => (r.id === id && r.status === "pending" ? { ...r, dismissedAt } : r));
}

// Resolve one request. Returns the updated list plus, when approved, the role
// the caller should now apply to that profile.
export function applyDecision(
  list: AccessRequest[],
  id: string,
  approve: boolean,
  decidedBy: string,
  decidedAt: string
): { list: AccessRequest[]; grant?: { name: string; role: ProjectRole } } {
  let grant: { name: string; role: ProjectRole } | undefined;
  const next = list.map((r) => {
    if (r.id !== id || r.status !== "pending") return r;
    if (approve) grant = { name: r.name, role: r.requestedRole };
    return { ...r, status: approve ? "approved" : "denied" as RequestStatus, decidedBy, decidedAt };
  });
  return { list: next, grant };
}

// ---- Local storage wrappers (the swappable seam) --------------------------

export function loadRequests(): AccessRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AccessRequest[]) : [];
  } catch {
    return [];
  }
}

function save(list: AccessRequest[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore private-mode storage errors */
  }
}

export function submitAccessRequest(input: {
  name: string;
  currentRole: ProjectRole;
  requestedRole: ProjectRole;
  reason: string;
}): AccessRequest {
  const request: AccessRequest = {
    id: crypto.randomUUID(),
    name: input.name,
    currentRole: input.currentRole,
    requestedRole: input.requestedRole,
    reason: input.reason.trim(),
    status: "pending",
    createdAt: new Date().toISOString()
  };
  save(addRequest(loadRequests(), request));
  return request;
}

export function decideAccessRequest(id: string, approve: boolean, decidedBy: string): void {
  const { list, grant } = applyDecision(loadRequests(), id, approve, decidedBy, new Date().toISOString());
  save(list);
  if (grant) setProfileRole(grant.name, grant.role);
}

export function pendingRequests(): AccessRequest[] {
  return pending(loadRequests());
}

export function dismissAccessRequest(id: string): void {
  save(dismissRequest(loadRequests(), id, new Date().toISOString()));
}
