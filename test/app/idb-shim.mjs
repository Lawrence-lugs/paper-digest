/**
 * Minimal in-memory IndexedDB-like shim, sufficient for
 * web/js/store/sessions.js (indexedDB.open, createObjectStore on upgrade,
 * transaction().objectStore(), objectStore.put/get/openCursor).
 *
 * Backed by a plain Map per (db, store). globalThis.__idbReset() clears all
 * storage so each test starts from an empty store. Node does not ship
 * IndexedDB, so the store tests mock it here (per the Phase 2 handoff: "a
 * real IndexedDB ... or mock it").
 */

const databases = new Map(); // dbName -> storeName -> Map(key, value)

class IDBRequest {
  constructor() {
    this.onsuccess = null;
    this.onerror = null;
    this.result = null;
    this.error = null;
  }
  _success(result) {
    this.result = result;
    if (typeof this.onsuccess === "function") {
      this.onsuccess({ target: this, type: "success" });
    }
  }
}

class IDBOpenDBRequest extends IDBRequest {}

class IDBDatabase {
  constructor(name) {
    this.name = name;
  }
  createObjectStore() {
    return new IDBObjectStore(this, arguments[0]);
  }
  transaction(..._args) {
    return new IDBTransaction(this);
  }
  close() {}
}

class IDBTransaction {
  constructor(db, ..._args) {
    this.db = db;
  }
  objectStore(name) {
    return new IDBObjectStore(this.db, name);
  }
}

class IDBObjectStore {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }
  map() {
    let stores = databases.get(this.db.name);
    if (!stores) {
      stores = new Map();
      databases.set(this.db.name, stores);
    }
    let entries = stores.get(this.name);
    if (!entries) {
      entries = new Map();
      stores.set(this.name, entries);
    }
    return entries;
  }
  put(value) {
    const req = new IDBRequest();
    const key =
      value != null && Object.prototype.hasOwnProperty.call(value, "key")
        ? value.key
        : value;
    this.map().set(key, { ...value });
    queueMicrotask(() => req._success(key));
    return req;
  }
  get(key) {
    const req = new IDBRequest();
    queueMicrotask(() => req._success(this.map().get(key) ?? null));
    return req;
  }
  openCursor() {
    const req = new IDBRequest();
    const entries = [...this.map().entries()];
    let i = 0;
    const cursor = { value: null };
    const advance = () => {
      if (i < entries.length) cursor.value = entries[i++][1];
      else cursor.value = null;
    };
    const deliver = () => {
      const hasCurrent = i < entries.length; // cursor.value valid *before* advancing
      advance();
      queueMicrotask(() => {
        req.result = hasCurrent ? cursor : null;
        if (typeof req.onsuccess === "function") {
          req.onsuccess({ target: req, type: "success" });
        }
      });
    };
    cursor.continue = deliver;
    deliver();
    return req;
  }
}

function openDB(name, version) {
  const req = new IDBOpenDBRequest();
  const db = new IDBDatabase(name);
  queueMicrotask(() => {
    // In real IndexedDB req.result is the database during onupgradeneeded.
    req.result = db;
    if (typeof req.onupgradeneeded === "function") {
      req.onupgradeneeded({ target: req, type: "upgradeneeded" });
    }
    req._success(db);
  });
  return req;
}

globalThis.indexedDB = { open: openDB, deleteDatabase: () => undefined };
globalThis.__idbReset = () => databases.clear();
