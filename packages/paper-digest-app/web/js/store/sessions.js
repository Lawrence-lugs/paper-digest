/**
 * Agent C store — IndexedDB-backed `Session` store.
 *
 * Sessions are keyed by <site>:<primary id> (see sessionKey). The store is
 * the single place figures and baseUrl live, so the template flow never
 * depends on figures being embedded in the AI's Markdown.
 */

const DB_NAME = "paper-digest";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function store(mode) {
  return openDb().then((db) => {
    const tx = db.transaction(STORE_NAME, mode);
    return tx.objectStore(STORE_NAME);
  });
}

/** Session key: <site>:<primary id>, primary id = arXiv id (version stripped),
 *  else DOI, else a hash of the URL. */
export function sessionKey(site, ids, sourceUrl) {
  let primary = null;
  if (ids && ids.arxiv) primary = String(ids.arxiv).replace(/v\d+$/, "");
  else if (ids && ids.doi) primary = String(ids.doi);
  else if (sourceUrl) primary = hashString(String(sourceUrl));
  else primary = "unknown";
  return `${site || "unknown"}:${primary}`;
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16);
}

function normalizeId(value) {
  if (!value) return null;
  const v = String(value).trim();
  const arxiv = v.match(/^(?:\d{4}\.\d{4,5})(?:v\d+)?$/i);
  if (arxiv) return { kind: "arxiv", id: v.replace(/v\d+$/i, "") };
  const doi = v.match(/^10\.\d+\/.+/);
  if (doi) return { kind: "doi", id: v };
  return null;
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const sessions = {
  /** Persist a session. */
  async put(session) {
    const st = await store("readwrite");
    await new Promise((resolve, reject) => {
      const req = st.put({ ...session, createdAt: session.createdAt ?? Date.now() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  /** Get a session by key. */
  async get(key) {
    const st = await store("readonly");
    return new Promise((resolve, reject) => {
      const req = st.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Find a session matching a Digest. Tries, in order:
   *  1. normalized id (arXiv id or DOI, version stripped),
   *  2. normalized title,
   *  Returns null when nothing matches (the UI then offers "Attach source").
   */
  async findByDigest(digest) {
    const meta = digest && digest.meta ? digest.meta : digest;
    const sessionsList = await this.list();
    const idCand = normalizeId(meta && meta.id);
    const titleCand = normalizeTitle(meta && meta.title);

    // 1. normalized id: match a session whose key carries the same primary id.
    if (idCand) {
      for (const s of sessionsList) {
        const primary = String(s.key).split(":").slice(1).join(":");
        if (primary === idCand.id) return s;
      }
    }

    // 2. normalized title.
    if (titleCand) {
      for (const s of sessionsList) {
        if (normalizeTitle(s.title) === titleCand) return s;
      }
    }

    return null;
  },

  /** List all sessions, newest first. */
  async list() {
    const st = await store("readonly");
    return new Promise((resolve, reject) => {
      const out = [];
      const req = st.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          out.push(cursor.value);
          cursor.continue();
        } else {
          resolve(out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
        }
      };
      req.onerror = () => reject(req.error);
    });
  },
};
