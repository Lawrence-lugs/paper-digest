// Stub: real IndexedDB session store owned by agent C (web/js/store/).
export const sessions = {
  put: async (s) => { throw new Error("NotImplemented: sessions.put"); },
  get: async (k) => { throw new Error("NotImplemented: sessions.get"); },
  findByDigest: async (d) => { throw new Error("NotImplemented: sessions.findByDigest"); },
  list: async () => { throw new Error("NotImplemented: sessions.list"); },
};
export function sessionKey(site, ids) {
  throw new Error("NotImplemented: sessionKey");
}
