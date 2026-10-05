const KEY_ACTIVE = "ktp_activeChallenge_v1";
const KEY_HISTORY = "ktp_challengeHistory_v1";
export const CUTOFF_HOUR = 3;
export const MAX_RECENT_HISTORY = 20;

export function dayKeyFor(date, cutoffHour = CUTOFF_HOUR) {
  const shifted = new Date(date.getTime() - cutoffHour * 60 * 60 * 1000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, "0");
  const d = String(shifted.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function loadActiveChallenge() {
  try { return JSON.parse(localStorage.getItem(KEY_ACTIVE) || "null"); }
  catch { return null; }
}
export function saveActiveChallenge(ch) { localStorage.setItem(KEY_ACTIVE, JSON.stringify(ch)); }
export function clearActiveChallenge() { localStorage.removeItem(KEY_ACTIVE); }
export function isActiveChallengeForNow(ch) { return !!ch && ch.dayKey === dayKeyFor(new Date()); }

export function startNewChallenge({ parkId, parkName, tagsText = "", fundraisingLink = "", tweetMode = "original", excludedAttractionIds = [] }) {
  const now = new Date();
  const ch = {
    id: crypto.randomUUID(),
    dayKey: dayKeyFor(now),
    startedAt: now.toISOString(),
    parkId,
    parkName,
    tweetMode,
    excludedAttractionIds: [...excludedAttractionIds],
    settings: { tagsText, fundraisingLink, tweetMode, excludedAttractionIds: [...excludedAttractionIds] },
    events: []
  };
  saveActiveChallenge(ch);
  return ch;
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function activityISO(ch) {
  if (ch?.endedAt) return ch.endedAt;
  const events = Array.isArray(ch?.events) ? ch.events : [];
  return events.at(-1)?.timeISO || ch?.startedAt || null;
}
function normalizeHistory(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  const saved = out.filter(x => x.saved === true);
  const recent = out.filter(x => x.saved !== true).slice(0, MAX_RECENT_HISTORY);
  return [...saved, ...recent].sort((a,b) => (Date.parse(activityISO(b) || "") || 0) - (Date.parse(activityISO(a) || "") || 0));
}
export function loadChallengeHistory() {
  try { const x = JSON.parse(localStorage.getItem(KEY_HISTORY) || "[]"); return Array.isArray(x) ? x : []; }
  catch { return []; }
}
function saveChallengeHistory(items) { localStorage.setItem(KEY_HISTORY, JSON.stringify(normalizeHistory(items))); }
export function archiveChallengeToHistory(ch, { saved = false } = {}) {
  if (!ch?.id) return;
  const entry = clone(ch);
  entry.endedAt = entry.endedAt || new Date().toISOString();
  entry.saved = !!saved;
  if (saved && !entry.savedAt) entry.savedAt = new Date().toISOString();
  saveChallengeHistory([entry, ...loadChallengeHistory()]);
}
export function setChallengeSaved(id, saved = true) {
  const now = new Date().toISOString();
  saveChallengeHistory(loadChallengeHistory().map(h => h.id === id ? { ...h, saved: !!saved, ...(saved ? { savedAt: h.savedAt || now } : { savedAt: undefined }) } : h));
}
export function deleteChallengeFromHistory(id) { saveChallengeHistory(loadChallengeHistory().filter(h => h.id !== id)); }
