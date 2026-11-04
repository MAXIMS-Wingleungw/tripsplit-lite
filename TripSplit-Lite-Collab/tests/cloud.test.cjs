const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = name => readFileSync(path.join(__dirname, '..', 'js', name), 'utf8');
const clone = value => structuredClone(value);
const stores = ['trips', 'members', 'exchangeRates', 'expenses', 'attachments', 'settlements', 'settings'];
const trip = (id, isShared = true) => ({ id, name: id, isShared, status: 'active', defaultCurrency: 'HKD' });
const expense = (id, tripId, name = id) => ({ id, tripId, name, adjustmentType: 'NONE', adjustmentAmountMinor: 0 });

class Firestore {
  constructor() {
    this.documents = new Map();
    this.listeners = new Set();
    this.pending = [];
    this.failure = null;
  }

  snapshot(ref, metadata = {}) {
    const meta = { fromCache: false, hasPendingWrites: false, ...metadata };
    if (!ref.isCollection) {
      const data = this.documents.get(ref.path);
      return { id: ref.path.split('/').at(-1), exists: !!data, data: () => clone(data), metadata: meta };
    }
    const docs = [];
    for (const [key, value] of this.documents) {
      if (key.startsWith(ref.path + '/') && key.split('/').length === ref.path.split('/').length + 1) {
        docs.push({ id: key.split('/').at(-1), data: () => clone(value) });
      }
    }
    return { docs, metadata: meta };
  }

  deliver(listener, metadata) {
    const snapshot = this.snapshot(listener.ref, metadata);
    this.pending.push(Promise.resolve().then(() => listener.callback(snapshot)));
  }

  ref(refPath, isCollection = false) {
    const server = this;
    return {
      path: refPath,
      isCollection,
      doc: id => server.ref(refPath + '/' + id),
      collection: name => server.ref(refPath + '/' + name, true),
      limit() { return this; },
      async get() { return server.snapshot(this); },
      async set(value, options) {
        if (server.failure) throw server.failure;
        const previous = options?.merge ? server.documents.get(refPath) : {};
        server.documents.set(refPath, clone({ ...previous, ...value }));
        server.notify(refPath);
      },
      async delete() {
        if (server.failure) throw server.failure;
        server.documents.delete(refPath);
        server.notify(refPath);
      },
      onSnapshot(options, callback, error) {
        assert.equal(options.includeMetadataChanges, true);
        const listener = { ref: this, callback, error };
        server.listeners.add(listener);
        server.deliver(listener);
        return () => server.listeners.delete(listener);
      }
    };
  }

  collection(name) { return this.ref(name, true); }
  settings() {}

  batch() {
    const writes = [];
    return {
      set: (ref, value) => writes.push([ref, value]),
      commit: async () => {
        if (this.failure) throw this.failure;
        for (const [ref, value] of writes) await ref.set(value);
      }
    };
  }

  notify(refPath) {
    for (const listener of this.listeners) {
      if (listener.ref.path === refPath || listener.ref.path === refPath.split('/').slice(0, -1).join('/')) {
        this.deliver(listener);
      }
    }
  }

  async flush() {
    while (this.pending.length) await Promise.all(this.pending.splice(0));
  }
}

async function browser(server, initial = {}, href = 'https://example.test/index.html') {
  const local = Object.fromEntries(stores.map(store => [store, new Map((initial[store] || []).map(x => [x.id, clone(x)]))]));
  const timers = new Map();
  const elements = new Map();
  let timerId = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: id !== 'app', innerHTML: '', remove() {}, addEventListener() {} });
    return elements.get(id);
  };
  const context = vm.createContext({
    URL, URLSearchParams, console: { warn() {}, log() {} },
    document: {
      title: 'TripSplit',
      getElementById: element,
      querySelector: selector => element(selector.slice(1))
    },
    location: new URL(href),
    history: { replaceState() {} },
    alert: message => { throw Error(message); },
    confirm: () => true,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    firebase: { apps: [{}], firestore: () => server },
    DB: {
      stores,
      async open() {},
      async all(store) { return [...local[store].values()].map(clone); },
      async put(store, item) { local[store].set(item.id, clone(item)); return item; },
      async del(store, id) { local[store].delete(id); },
      async clear(store) { local[store].clear(); }
    }
  });
  context.window = context;
  vm.runInContext(source('cloud.js'), context);
  vm.runInContext(source('app.js').replace('App.init();', 'globalThis.appReady = App.init();'), context);
  const app = vm.runInContext('App', context);
  const renders = [];
  const messages = [];
  app.bind = () => {};
  app.go = page => { app.page = page; renders.push(page); context.Cloud.updateUI(); };
  app.nav = () => context.Cloud.updateUI();
  app.msg = message => messages.push(message);
  await context.appReady;
  return {
    context, app, cloud: context.Cloud, local, elements, renders, messages,
    async flush() {
      await server.flush();
      while (timers.size) {
        const callbacks = [...timers.values()];
        timers.clear();
        for (const callback of callbacks) await callback();
      }
    },
    saved() { return Object.fromEntries(stores.map(store => [store, [...local[store].values()].map(clone)])); }
  };
}

test('existing calculation and backup compatibility tests', () => {
  const messages = [];
  const context = vm.createContext({ console: { log: message => messages.push(message) } });
  vm.runInContext(source('calculations.js'), context);
  vm.runInContext(readFileSync(path.join(__dirname, 'tests.js'), 'utf8'), context);
  assert.equal(messages.length, 13);
  assert.deepEqual(messages.filter(message => message.startsWith('FAIL ')), []);
});

test('startup exposes Cloud to window and restores the last selected shared trip and its badge', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  const client = await browser(server, {
    trips: [trip('local', false), trip('shared')],
    settings: [{ id: 'lastTripId', value: 'shared' }]
  });
  assert.equal(client.cloud.enabled, true);
  assert.equal(client.context.window.Cloud, client.cloud);
  assert.equal(client.app.trip.id, 'shared');
  assert.equal(client.cloud.activeTripId, 'shared');
  assert.equal(client.cloud.unsubscribers.length, 5);
  await client.flush();
  assert.equal(client.cloud.status, 'synced');
  assert.match(client.elements.get('cloudStatus').innerHTML, /即時共享中/);

  await client.app.openTrip('local');
  assert.equal(client.cloud.activeTripId, null);
  const reopened = await browser(server, client.saved());
  assert.equal(reopened.app.trip.id, 'local');
  assert.equal(reopened.cloud.activeTripId, null);
});

test('two independent clients synchronize adds, edits and deletes for every shared child collection', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  const a = await browser(server, { trips: [trip('shared')] });
  const b = await browser(server, { trips: [trip('shared')] });
  await a.flush();
  await b.flush();
  for (const store of ['members', 'expenses', 'settlements', 'exchangeRates']) {
    const item = { id: store, tripId: 'shared', name: 'added' };
    await a.app.saveItem(store, item);
    await b.flush();
    assert.equal(b.app.items(store)[0].name, 'added', store + ' add');
    await b.app.saveItem(store, { ...item, name: 'edited by B' });
    await a.flush();
    assert.equal(a.app.items(store)[0].name, 'edited by B', store + ' edit');
    await a.app.deleteItem(store, item.id);
    await b.flush();
    assert.equal(b.app.items(store).length, 0, store + ' delete');
  }
});

test('reopening refreshes the first snapshot and removes offline-deleted records only for that trip', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  server.documents.set('shared_trips/shared/expenses/changed', expense('changed', 'shared', 'latest'));
  const client = await browser(server, {
    trips: [trip('shared')],
    expenses: [expense('changed', 'shared', 'stale'), expense('deleted', 'shared'), expense('private', 'other')]
  });
  const before = client.renders.length;
  await client.flush();
  assert.equal(client.app.items('expenses')[0].name, 'latest');
  assert.equal(client.local.expenses.has('deleted'), false);
  assert.equal(client.local.expenses.has('private'), true);
  assert.ok(client.renders.length > before);
});

test('remote updates are not suppressed during a local write and do not close an open form', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  const client = await browser(server, { trips: [trip('shared')] });
  await client.flush();
  await client.app.saveItem('expenses', expense('mine', 'shared'));
  client.elements.get('modal').hidden = false;
  const before = client.renders.length;
  await server.ref('shared_trips/shared/expenses/theirs').set(expense('theirs', 'shared'));
  await client.flush();
  assert.equal(client.app.items('expenses').length, 2);
  assert.equal(client.renders.length, before);
  assert.equal(client.elements.get('modal').hidden, false);
});

test('sharing a non-selected trip uploads only its own records and does not switch subscriptions', async () => {
  const server = new Firestore();
  const client = await browser(server, {
    trips: [trip('first', false), trip('second', false)],
    expenses: [expense('one', 'first'), expense('two', 'second')]
  });
  await client.cloud.shareTrip('second');
  assert.equal(server.documents.has('shared_trips/second/expenses/two'), true);
  assert.equal(server.documents.has('shared_trips/second/expenses/one'), false);
  assert.equal(client.cloud.activeTripId, null);
  await client.app.reload();
  await client.app.openTrip('second');
  await client.flush();
  assert.equal(client.cloud.activeTripId, 'second');
  const reopened = await browser(server, client.saved());
  await reopened.flush();
  assert.equal(reopened.app.trip.id, 'second');
  assert.match(reopened.elements.get('cloudStatus').innerHTML, /即時共享中/);
});

test('shared URLs join automatically and persist the joined trip for a plain-URL restart', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/joined', trip('joined'));
  const client = await browser(server, { trips: [trip('local', false)] }, 'https://example.test/index.html?trip=joined');
  await client.flush();
  assert.equal(client.app.trip.id, 'joined');
  assert.equal(client.cloud.activeTripId, 'joined');
  const reopened = await browser(server, client.saved());
  await reopened.flush();
  assert.equal(reopened.app.trip.id, 'joined');
  assert.equal(reopened.cloud.activeTripId, 'joined');
});

test('creating a local trip while a shared trip is selected never overwrites the shared trip', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  const client = await browser(server, { trips: [trip('shared')] });
  await client.flush();
  await client.app.saveItem('trips', trip('new-local', false));
  assert.equal(server.documents.get('shared_trips/shared').id, 'shared');
  assert.equal(server.documents.has('shared_trips/new-local'), false);
});

test('failed cloud writes and deletes reject instead of reporting successful synchronization', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  const client = await browser(server, { trips: [trip('shared')] });
  await client.flush();
  server.failure = Object.assign(Error('permission denied'), { code: 'permission-denied' });
  await assert.rejects(client.app.saveItem('expenses', expense('failed', 'shared')), /permission denied/);
  assert.equal(client.local.expenses.has('failed'), true);
  assert.equal(client.cloud.status, 'error');
  await client.app.reload();
  await assert.rejects(client.app.deleteItem('expenses', 'failed'), /permission denied/);
  assert.equal(client.cloud.status, 'error');
  server.failure = null;
  await client.cloud.testConnection();
  await client.flush();
  assert.equal(client.cloud.activeTripId, 'shared');
  assert.equal(client.cloud.status, 'synced');
});

test('failed initial publishing does not persist a false shared flag', async () => {
  const server = new Firestore();
  const client = await browser(server, { trips: [trip('local', false)] });
  server.failure = Error('write blocked');
  await assert.rejects(client.cloud.shareTrip('local'), /write blocked/);
  assert.equal(client.app.data.trips[0].isShared, false);
  assert.equal(client.local.trips.get('local').isShared, false);
});

test('late snapshots and pending refreshes from an old subscription cannot redraw a different trip', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  const client = await browser(server, { trips: [trip('shared'), trip('local', false)] });
  await client.flush();
  const listener = [...server.listeners].find(x => x.ref.path === 'shared_trips/shared/expenses');
  server.documents.set('shared_trips/shared/expenses/late', expense('late', 'shared'));
  client.cloud.onRemoteChange('expenses');
  await client.app.openTrip('local');
  const before = client.renders.length;
  await listener.callback(server.snapshot(listener.ref));
  await client.flush();
  assert.equal(client.app.trip.id, 'local');
  assert.equal(client.cloud.activeTripId, null);
  assert.equal(client.renders.length, before);
  assert.equal(client.local.expenses.has('late'), false);
});

test('cached snapshots do not delete local records or claim a server-confirmed connection', async () => {
  const server = new Firestore();
  const deliver = server.deliver.bind(server);
  server.deliver = listener => deliver(listener, { fromCache: true });
  server.documents.set('shared_trips/shared', trip('shared'));
  const client = await browser(server, {
    trips: [trip('shared')], expenses: [expense('cached-local', 'shared')]
  });
  await client.flush();
  assert.equal(client.local.expenses.has('cached-local'), true);
  assert.equal(client.cloud.status, 'connecting');
  for (const listener of server.listeners) deliver(listener, { fromCache: false });
  await client.flush();
  assert.equal(client.local.expenses.has('cached-local'), false);
  assert.equal(client.cloud.status, 'synced');
});

test('a pending local snapshot is applied after its server acknowledgement', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  const client = await browser(server, { trips: [trip('shared')] });
  await client.flush();
  const listener = [...server.listeners].find(x => x.ref.path === 'shared_trips/shared/expenses');
  server.documents.set('shared_trips/shared/expenses/ack', expense('ack', 'shared'));
  await listener.callback(server.snapshot(listener.ref, { hasPendingWrites: true }));
  assert.equal(client.local.expenses.has('ack'), false);
  await listener.callback(server.snapshot(listener.ref, { hasPendingWrites: false }));
  await client.flush();
  assert.equal(client.app.items('expenses')[0].id, 'ack');
});

test('diagnostic retry initializes a previously unavailable SDK and restores subscriptions', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  const client = await browser(server, { trips: [trip('shared')] });
  await client.flush();
  client.cloud.unsubscribe();
  client.cloud.db = null;
  client.cloud.enabled = false;
  delete client.context.firebase;
  assert.equal((await client.cloud.testConnection()).code, 'SDK_NOT_LOADED');
  client.context.firebase = { apps: [{}], firestore: () => server };
  assert.equal((await client.cloud.testConnection()).ok, true);
  await client.flush();
  assert.equal(client.cloud.unsubscribers.length, 5);
  assert.equal(client.cloud.activeTripId, 'shared');
  assert.match(client.elements.get('cloudStatus').innerHTML, /即時共享中/);
});

test('deleting another shared trip targets its ID rather than the active trip', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/active', trip('active'));
  server.documents.set('shared_trips/other', trip('other'));
  const client = await browser(server, { trips: [trip('active'), trip('other')] });
  await client.flush();
  await client.app.deleteTrip('other');
  await client.flush();
  assert.equal(server.documents.has('shared_trips/active'), true);
  assert.equal(server.documents.has('shared_trips/other'), false);
  assert.equal(client.cloud.activeTripId, 'active');
});
