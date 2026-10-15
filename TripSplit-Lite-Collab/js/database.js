const DB = {
  name: 'TripSplitLiteDB',
  version: 2,
  db: null,
  stores: ['trips', 'members', 'exchangeRates', 'expenses', 'attachments', 'settlements', 'settings'],
  open() {
    return new Promise((ok, bad) => {
      const r = indexedDB.open(this.name, this.version);
      r.onupgradeneeded = e => {
        const d = e.target.result;
        this.stores.forEach(s => {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        });
      };
      r.onsuccess = () => {
        this.db = r.result;
        ok();
      };
      r.onerror = () => bad(r.error);
    });
  },
  all(s) {
    return new Promise((ok, bad) => {
      const r = this.db.transaction(s).objectStore(s).getAll();
      r.onsuccess = () => ok(r.result);
      r.onerror = () => bad(r.error);
    });
  },
  put(s, v) {
    return new Promise((ok, bad) => {
      const r = this.db.transaction(s, 'readwrite').objectStore(s).put(v);
      r.onsuccess = () => ok(v);
      r.onerror = () => bad(r.error);
    });
  },
  del(s, id) {
    return new Promise((ok, bad) => {
      const r = this.db.transaction(s, 'readwrite').objectStore(s).delete(id);
      r.onsuccess = () => ok();
      r.onerror = () => bad(r.error);
    });
  },
  clear(s) {
    return new Promise((ok, bad) => {
      const r = this.db.transaction(s, 'readwrite').objectStore(s).clear();
      r.onsuccess = () => ok();
      r.onerror = () => bad(r.error);
    });
  }
};

const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
