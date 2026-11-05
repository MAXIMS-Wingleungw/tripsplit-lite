const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = name => readFileSync(path.join(__dirname, '..', 'js', name), 'utf8');
const clone = value => structuredClone(value);
const dbContext = vm.createContext({});
vm.runInContext(source('database.js'), dbContext);
const stores = Array.from(vm.runInContext('DB.stores', dbContext));
const dbVersion = vm.runInContext('DB.version', dbContext);
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
    uid: require('node:crypto').randomUUID,
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
      stores, version: dbVersion,
      async open() {},
      async all(store) { return [...local[store].values()].map(clone); },
      async put(store, item) { local[store].set(item.id, clone(item)); return item; },
      async del(store, id) { local[store].delete(id); },
      async clear(store) { local[store].clear(); }
    }
  });
  context.window = context;
  vm.runInContext(source('calculations.js'), context);
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
  assert.equal(client.cloud.unsubscribers.length, Object.keys(client.cloud.collectionStores).length + 1);
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
  for (const store of Object.keys(a.cloud.collectionStores)) {
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
  assert.equal(client.cloud.unsubscribers.length, Object.keys(client.cloud.collectionStores).length + 1);
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

const refundExpense = (overrides = {}) => ({
  id: 'refund', tripId: 'shared', name: 'Shopping', currency: 'HKD',
  expenseDate: '2026-11-04', category: '購物',
  baseAmountMinor: 10000, adjustmentType: 'REFUND',
  adjustmentMode: 'AMOUNT', adjustmentValue: 10, adjustmentAmountMinor: 1000,
  splitMethod: 'EQUAL',
  payers: [{ memberId: 'A', amountMinor: 9000 }],
  shares: [
    { memberId: 'A', baseShareMinor: 5000, adjustmentShareMinor: -500, finalShareMinor: 4500, inputValue: 1 },
    { memberId: 'B', baseShareMinor: 5000, adjustmentShareMinor: -500, finalShareMinor: 4500, inputValue: 1 }
  ], finalAmountMinor: 9000,
  ...overrides
});

test('legacy refunds become pending, restore gross shares/payers and recompute settlement without altering recorded repayments', async () => {
  const server = new Firestore();
  const client = await browser(server, {
    trips: [trip('shared', false)],
    members: ['A', 'B'].map(id => ({ id, tripId: 'shared', name: id })),
    expenses: [refundExpense()],
    settlements: [{ id: 'paid', tripId: 'shared', currency: 'HKD', fromMemberId: 'B', toMemberId: 'A', amountMinor: 1000 }]
  });
  const normalized = client.app.items('expenses')[0];
  assert.equal(normalized.refundReceived, false);
  assert.equal(normalized.refundLegacyPending, true);
  assert.equal(normalized.refundReceivedAmountMinor, 0);
  assert.equal(normalized.adjustmentAmountMinor, 1000);
  assert.equal(normalized.finalAmountMinor, 10000);
  assert.equal(normalized.payers[0].amountMinor, 10000);
  assert.deepEqual(normalized.shares.map(s => s.finalShareMinor), [5000, 5000]);
  assert.deepEqual(Array.from(client.app.balances('HKD'), b => b.amount), [4000, -4000]);
  assert.equal(client.local.settlements.get('paid').amountMinor, 1000);
  assert.match(client.app.refundStatus(normalized), /待收退稅/);
  await client.app.reload();
  assert.equal(client.app.items('expenses')[0].finalAmountMinor, 10000);
});

test('refund actual receipt, cancellation and re-confirmation synchronize and update settlement on both clients', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  for (const id of ['A', 'B']) server.documents.set('shared_trips/shared/members/' + id, { id, tripId: 'shared', name: id });
  server.documents.set('shared_trips/shared/expenses/refund', refundExpense());
  const a = await browser(server, { trips: [trip('shared')] });
  const b = await browser(server, { trips: [trip('shared')] });
  await a.flush();
  await b.flush();
  assert.equal(b.app.items('expenses')[0].finalAmountMinor, 10000);
  await a.app.saveItem('expenses', refundExpense({ refundReceived: true, refundReceivedAmountMinor: 700 }));
  await b.flush();
  const received = b.app.items('expenses')[0];
  assert.equal(received.finalAmountMinor, 9300);
  assert.equal(received.adjustmentAmountMinor, 1000);
  assert.equal(received.payers[0].amountMinor, 9300);
  assert.deepEqual(received.shares.map(s => s.finalShareMinor), [4650, 4650]);
  assert.deepEqual(Array.from(b.app.balances('HKD'), x => x.amount), [4650, -4650]);
  assert.match(b.app.refundStatus(received), /已收到退稅/);
  await b.app.saveItem('expenses', { ...received, refundReceived: false });
  await a.flush();
  const pending = a.app.items('expenses')[0];
  assert.equal(pending.refundReceivedAmountMinor, 0);
  assert.equal(pending.finalAmountMinor, 10000);
  assert.deepEqual(Array.from(a.app.balances('HKD'), x => x.amount), [5000, -5000]);
  await a.app.saveItem('expenses', { ...pending, refundReceived: true, refundReceivedAmountMinor: 0 });
  await b.flush();
  assert.equal(b.app.items('expenses')[0].refundReceived, true);
  assert.equal(b.app.items('expenses')[0].finalAmountMinor, 10000);
  const restarted = await browser(server, b.saved());
  await restarted.flush();
  assert.equal(restarted.app.items('expenses')[0].refundReceived, true);
});

test('refund allocation uses actual amount for all split methods, currency precision and exact rounding', () => {
  const context = vm.createContext({});
  vm.runInContext(source('calculations.js'), context);
  const money = vm.runInContext('Money', context);
  for (const [splitMethod, inputs] of [
    ['EQUAL', [{ memberId: 'A' }, { memberId: 'B' }, { memberId: 'C' }]],
    ['EXACT', [{ memberId: 'A', value: 30 }, { memberId: 'B', value: 70 }]],
    ['PERCENTAGE', [{ memberId: 'A', value: 30 }, { memberId: 'B', value: 70 }]],
    ['SHARES', [{ memberId: 'A', value: 1 }, { memberId: 'B', value: 2 }]]
  ]) {
    const e = { baseAmountMinor: 100, adjustmentType: 'REFUND', adjustmentAmountMinor: 50, splitMethod };
    assert.equal(money.shares(e, inputs).reduce((sum, s) => sum + s.finalShareMinor, 0), 100);
    e.refundReceived = true;
    e.refundReceivedAmountMinor = 7;
    const shares = money.shares(e, inputs);
    assert.equal(shares.reduce((sum, s) => sum + s.finalShareMinor, 0), 93);
    assert.equal(shares.reduce((sum, s) => sum + s.adjustmentShareMinor, 0), -7);
  }
  assert.equal(money.toMinor(7.23, 'HKD'), 723);
  assert.equal(money.toMinor(723, 'JPY'), 723);
  for (const amount of [-1, 10001, NaN, undefined, 1.5, '700']) {
    assert.throws(() => money.finalAmount(refundExpense({ refundReceived: true, refundReceivedAmountMinor: amount })), /實收退稅/);
  }
  assert.equal(money.finalAmount(refundExpense({ adjustmentType: 'ADDITIVE_TAX' })), 11000);
  assert.equal(money.finalAmount(refundExpense({ adjustmentType: 'NONE' })), 10000);
  assert.equal(money.finalAmount(refundExpense({ refundReceived: true, refundReceivedAmountMinor: 1200 })), 8800);
  assert.equal(money.finalAmount(refundExpense({ refundReceived: true, refundReceivedAmountMinor: 10000 })), 0);
  const taxable = { baseAmountMinor: 10000, adjustmentType: 'ADDITIVE_TAX', adjustmentAmountMinor: 1000, splitMethod: 'EQUAL' };
  assert.equal(money.shares(taxable, [{ memberId: 'A' }, { memberId: 'B' }]).reduce((sum, s) => sum + s.finalShareMinor, 0), 11000);
});

test('legacy multi-payer migration stays balanced, including old full-estimate refunds', () => {
  const context = vm.createContext({});
  vm.runInContext(source('calculations.js'), context);
  const money = vm.runInContext('Money', context);
  const multi = refundExpense({ payers: [{ memberId: 'A', amountMinor: 6000 }, { memberId: 'B', amountMinor: 3000 }] });
  assert.deepEqual(Array.from(money.normalizeRefund(multi).payers, p => p.amountMinor), [6667, 3333]);
  const full = refundExpense({ adjustmentAmountMinor: 10000, finalAmountMinor: 0, payers: [{ memberId: 'A', amountMinor: 0 }] });
  assert.equal(money.normalizeRefund(full).payers[0].amountMinor, 10000);
});

test('backup import and export preserve receipt fields and safely migrate legacy refunds', async () => {
  const server = new Firestore();
  const client = await browser(server);
  const data = {
    trips: [trip('shared', false)],
    expenses: [
      refundExpense({ id: 'legacy' }),
      refundExpense({ id: 'confirmed', refundReceived: true, refundReceivedAmountMinor: 723 }),
      refundExpense({ id: 'pending', refundReceived: false, refundReceivedAmountMinor: 0 })
    ]
  };
  await client.app.importData({ text: async () => JSON.stringify({ application: { id: 'tripsplit-lite' }, data }) });
  assert.equal(client.app.items('expenses').length, 3);
  assert.equal(client.local.expenses.get('legacy').refundReceived, false);
  assert.equal(client.local.expenses.get('confirmed').finalAmountMinor, 9277);
  let exported;
  client.context.Blob = Blob;
  client.context.URL = {
    createObjectURL(blob) { exported = blob; return 'blob:test'; },
    revokeObjectURL() {}
  };
  client.context.document.createElement = () => ({ click() {} });
  await client.app.exportData();
  const backup = JSON.parse(await exported.text());
  assert.equal(backup.data.expenses.find(e => e.id === 'confirmed').refundReceivedAmountMinor, 723);
  assert.equal(backup.data.expenses.find(e => e.id === 'legacy').refundReceived, false);
  assert.equal(backup.data.expenses.find(e => e.id === 'pending').adjustmentAmountMinor, 1000);
});

test('travel plans validate fields, sort by date/time, isolate trips and do not affect accounting', async () => {
  const server = new Firestore();
  const client = await browser(server, { trips: [trip('local', false), trip('other', false)] });
  const add = values => client.app.saveTravelPlan({ kind: 'itinerary', name: 'Activity', date: '2026-11-06', ...values });
  for (const date of ['', '2026-02-30', 'not-a-date']) await assert.rejects(add({ date }), /日期/);
  for (const time of ['24:00', '09:60', '9:30']) await assert.rejects(add({ time }), /時間/);
  await assert.rejects(add({ name: ' ' }), /活動名稱/);
  await assert.rejects(add({ kind: 'unknown' }), /分類/);
  const noTime = await add({ name: 'Flexible', time: '' });
  await add({ name: 'Evening', time: '18:30' });
  await add({ name: 'Morning', time: '09:00' });
  await add({ name: 'Earlier date', date: '2026-11-05', time: '20:00' });
  await client.app.reload();
  assert.deepEqual(Array.from(client.app.sortedTravelPlans('itinerary'), x => x.name), ['Earlier date', 'Morning', 'Evening', 'Flexible']);
  const edited = await client.app.saveTravelPlan({ ...noTime, name: 'Edited', location: 'Station', transport: 'Train', notes: 'Line 1' }, noTime.id);
  assert.equal(edited.createdAt, noTime.createdAt);
  await client.app.openTrip('other');
  assert.equal(client.app.sortedTravelPlans('itinerary').length, 0);
  await assert.rejects(client.app.saveTravelPlan(edited, edited.id), /找不到/);
  await assert.rejects(client.app.toggleTravelPlan(edited.id), /找不到/);
  await assert.rejects(client.app.deleteTravelPlan(edited.id), /找不到/);
  await client.app.openTrip('local');
  await client.app.deleteTravelPlan(noTime.id);
  assert.equal(client.app.items('travelPlans').length, 3);
  assert.equal(client.app.items('expenses').length, 0);
  assert.equal(client.app.items('settlements').length, 0);
  const reopened = await browser(server, client.saved());
  assert.equal(reopened.app.items('travelPlans').length, 3);
});

test('travel plan CRUD and wish-list completion synchronize between independent users', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  const a = await browser(server, { trips: [trip('shared')] });
  const b = await browser(server, { trips: [trip('shared')] });
  await a.flush();
  await b.flush();
  for (const kind of ['itinerary', 'food', 'shopping']) {
    const item = await a.app.saveTravelPlan({
      kind, name: kind, date: '2026-11-05', time: '',
      location: 'Shop', transport: 'Walk', notes: 'Note', completed: false
    });
    await b.flush();
    assert.equal(b.app.sortedTravelPlans(kind)[0].name, kind);
    await b.app.saveTravelPlan({ ...item, name: 'Edited ' + kind }, item.id);
    await a.flush();
    assert.equal(a.app.sortedTravelPlans(kind)[0].name, 'Edited ' + kind);
    if (kind !== 'itinerary') {
      await b.app.toggleTravelPlan(item.id);
      await a.flush();
      assert.equal(a.app.sortedTravelPlans(kind)[0].completed, true);
      await a.app.toggleTravelPlan(item.id);
      await b.flush();
      assert.equal(b.app.sortedTravelPlans(kind)[0].completed, false);
    } else {
      await assert.rejects(a.app.toggleTravelPlan(item.id), /清單項目/);
    }
    await a.app.deleteTravelPlan(item.id);
    await b.flush();
    assert.equal(b.app.sortedTravelPlans(kind).length, 0);
  }
});

test('local plan publishing uploads the correct trip, joins download plans, and first snapshot removes offline deletions', async () => {
  const server = new Firestore();
  const item = { id: 'plan', tripId: 'target', kind: 'food', name: 'Cafe', completed: true };
  const a = await browser(server, {
    trips: [trip('local', false), trip('target', false)],
    travelPlans: [item, { ...item, id: 'private', tripId: 'local' }]
  });
  await a.cloud.shareTrip('target');
  assert.equal(server.documents.has('shared_trips/target/travelPlans/plan'), true);
  assert.equal(server.documents.has('shared_trips/target/travelPlans/private'), false);
  const b = await browser(server, {}, 'https://example.test/index.html?trip=target');
  await b.flush();
  assert.equal(b.app.items('travelPlans')[0].completed, true);
  const saved = b.saved();
  server.documents.delete('shared_trips/target/travelPlans/plan');
  const reopened = await browser(server, saved);
  await reopened.flush();
  assert.equal(reopened.app.items('travelPlans').length, 0);
  await a.app.deleteTrip('target');
  assert.equal(a.local.travelPlans.has('plan'), false);
  assert.equal(a.local.travelPlans.has('private'), true);
});

test('travel plan backup round trip includes schema 3 and imports old backups with empty planning data', async () => {
  const server = new Firestore();
  const client = await browser(server, {
    trips: [trip('local', false)],
    travelPlans: ['itinerary', 'food', 'shopping'].map(kind => ({
      id: kind, tripId: 'local', kind, name: kind, date: '2026-11-04', time: '',
      location: 'Place', transport: 'Bus', notes: 'Note', completed: kind === 'food'
    }))
  });
  let exported;
  client.context.Blob = Blob;
  client.context.URL = {
    createObjectURL(blob) { exported = blob; return 'blob:test'; }, revokeObjectURL() {}
  };
  client.context.document.createElement = () => ({ click() {} });
  await client.app.exportData();
  const backup = JSON.parse(await exported.text());
  assert.equal(backup.schemaVersion, 3);
  assert.equal(backup.data.travelPlans.length, 3);
  await client.app.importData({ text: async () => JSON.stringify(backup) });
  assert.equal(client.app.items('travelPlans').length, 3);
  assert.equal(client.app.sortedTravelPlans('food')[0].completed, true);
  delete backup.data.travelPlans;
  backup.schemaVersion = 2;
  await client.app.importData({ text: async () => JSON.stringify(backup) });
  assert.equal(client.app.items('travelPlans').length, 0);
  assert.equal(client.app.trip.id, 'local');
});

test('planning render escapes user text and retains selected tab after refresh', async () => {
  const server = new Firestore();
  const client = await browser(server, {
    trips: [trip('local', false)],
    travelPlans: [{ id: 'plan', tripId: 'local', kind: 'food', name: '<img src=x>', location: '<script>', notes: '</div>' }]
  });
  client.app.planTab = 'food';
  client.app.travelPlans();
  const html = client.elements.get('view').innerHTML;
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;\/div&gt;/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /aria-selected="true"[^>]+data-tab="food"/);
  assert.equal(client.app.planTab, 'food');
});

test('planning write or listener permission failures remain explicit and cannot claim synced status', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  const client = await browser(server, { trips: [trip('shared')] });
  await client.flush();
  const denied = Object.assign(Error('travelPlans permission denied'), { code: 'permission-denied' });
  const listener = [...server.listeners].find(x => x.ref.path.endsWith('/travelPlans'));
  listener.error(denied);
  assert.equal(client.cloud.status, 'error');
  assert.match(client.cloud.initError, /travelPlans/);
  server.failure = denied;
  await assert.rejects(client.app.saveTravelPlan({ kind: 'food', name: 'Local cache' }), /permission denied/);
  assert.equal(client.local.travelPlans.size, 1);
});

test('central receipt confirmation preserves estimate, updates settlement and synchronizes cancellation', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  server.documents.set('shared_trips/shared/expenses/refund', refundExpense({ refundReceived: false }));
  const a = await browser(server, { trips: [trip('shared'), trip('other', false)] });
  const b = await browser(server, { trips: [trip('shared')] });
  await a.flush();
  await b.flush();
  for (const value of ['', -1, 'bad', 101]) await assert.rejects(a.app.saveRefundReceipt('refund', true, value), /實收/);
  const snapshot = JSON.stringify(a.app.items('expenses')[0]);
  await a.app.saveRefundReceipt('refund', true, '7', undefined, snapshot);
  await b.flush();
  const received = b.app.items('expenses')[0];
  assert.equal(received.finalAmountMinor, 9300);
  assert.equal(received.payers[0].amountMinor, 9300);
  assert.equal(received.adjustmentAmountMinor, 1000);
  assert.deepEqual(received.shares.map(x => x.finalShareMinor), [4650, 4650]);
  await assert.rejects(b.app.saveRefundReceipt('refund', false, '', undefined, snapshot), /已由同行者更新/);
  await b.app.saveRefundReceipt('refund', false, '');
  await a.flush();
  assert.equal(a.app.items('expenses')[0].finalAmountMinor, 10000);
  assert.equal(a.app.items('expenses')[0].refundReceivedAmountMinor, 0);
  await a.app.openTrip('other');
  await assert.rejects(a.app.saveRefundReceipt('refund', true, 7), /目前旅程/);
});

test('central receipt multi-payer allocation must be explicitly balanced for confirmation and cancellation', async () => {
  const client = await browser(new Firestore(), {
    trips: [trip('shared', false)],
    expenses: [refundExpense({ refundReceived: false, payers: [
      { memberId: 'A', amountMinor: 6000 }, { memberId: 'B', amountMinor: 4000 }
    ] })]
  });
  await assert.rejects(client.app.saveRefundReceipt('refund', true, 10), /核對/);
  await assert.rejects(client.app.saveRefundReceipt('refund', true, 10, [60, 40]), /不會自動分配/);
  await assert.rejects(client.app.saveRefundReceipt('refund', true, 10, [-1, 91]), /非負/);
  await client.app.saveRefundReceipt('refund', true, 10, [60, 30]);
  await client.app.reload();
  assert.deepEqual(client.app.items('expenses')[0].payers.map(p => p.amountMinor), [6000, 3000]);
  await assert.rejects(client.app.saveRefundReceipt('refund', false, '', [60, 30]), /不會自動分配/);
  await client.app.saveRefundReceipt('refund', false, '', [60, 40]);
  await client.app.reload();
  assert.deepEqual(client.app.items('expenses')[0].payers.map(p => p.amountMinor), [6000, 4000]);
});

test('daily page shows one selected date, preserves date per trip and handles old/new time fields', async () => {
  const client = await browser(new Firestore(), {
    trips: [trip('local', false), trip('other', false)],
    travelPlans: [
      { id: 'legacy', tripId: 'local', kind: 'itinerary', name: 'Old activity', date: '2026-11-05', time: '10:00' },
      { id: 'new', tripId: 'local', kind: 'itinerary', name: 'New activity', date: '2026-11-05', startTime: '09:00', endTime: '09:45' },
      { id: 'other-day', tripId: 'local', kind: 'itinerary', name: 'Tomorrow', date: '2026-11-06', startTime: '' }
    ]
  });
  assert.deepEqual(Array.from(client.app.sortedTravelPlans('itinerary'), x => x.id), ['new', 'legacy', 'other-day']);
  client.app.travelPlans();
  let html = client.elements.get('view').innerHTML;
  assert.match(html, /09:00 ～ 09:45/);
  assert.match(html, /Old activity/);
  assert.doesNotMatch(html, />Tomorrow</);
  await client.app.selectPlanDate('2026-11-06');
  client.app.travelPlans();
  html = client.elements.get('view').innerHTML;
  assert.match(html, /Tomorrow/);
  assert.doesNotMatch(html, /Old activity/);
  await client.app.openTrip('other');
  await client.app.selectPlanDate('2026-12-01');
  await client.app.openTrip('local');
  assert.equal(client.app.selectedPlanDate(), '2026-11-06');
  const restarted = await browser(new Firestore(), client.saved());
  assert.equal(restarted.app.selectedPlanDate(), '2026-11-06');
});

test('start/end time validation, shared persistence and backups preserve new and legacy fields', async () => {
  const server = new Firestore();
  server.documents.set('shared_trips/shared', trip('shared'));
  const a = await browser(server, { trips: [trip('shared')] });
  const b = await browser(server, { trips: [trip('shared')] });
  await a.flush();
  await b.flush();
  const values = { kind: 'itinerary', name: 'Activity', date: '2026-11-05', startTime: '09:00', endTime: '10:30' };
  await assert.rejects(a.app.saveTravelPlan({ ...values, endTime: '08:00' }), /早於/);
  await assert.rejects(a.app.saveTravelPlan({ ...values, endTime: '24:00' }), /完結時間/);
  const item = await a.app.saveTravelPlan(values);
  await b.flush();
  assert.equal(b.app.items('travelPlans')[0].startTime, '09:00');
  assert.equal(b.app.items('travelPlans')[0].time, '09:00');
  assert.equal(b.app.items('travelPlans')[0].endTime, '10:30');
  const edited = await b.app.saveTravelPlan({ ...item, startTime: '', endTime: '' }, item.id);
  assert.equal(edited.time, '');
  await a.flush();
  const restarted = await browser(server, a.saved());
  await restarted.flush();
  assert.equal(restarted.app.items('travelPlans')[0].endTime, '');
  await restarted.app.importData({ text: async () => JSON.stringify({
    application: { id: 'tripsplit-lite' }, data: {
      trips: [trip('shared', false)], travelPlans: [item],
      expenses: [refundExpense({ refundReceived: true, refundReceivedAmountMinor: 700 })]
    }
  }) });
  assert.equal(restarted.app.items('travelPlans')[0].endTime, '10:30');
  assert.equal(restarted.app.items('expenses')[0].refundReceivedAmountMinor, 700);
});
