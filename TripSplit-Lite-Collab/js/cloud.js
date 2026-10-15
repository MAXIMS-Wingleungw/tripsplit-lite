// TripSplit Lite - Firebase Cloud Realtime Sync Module
const Cloud = {
  config: {
    apiKey: "AIzaSyB-qL5U9RjpBXCPJVrrBHuWZ0VYpYIk4aI",
    authDomain: "tripsplit-26993.firebaseapp.com",
    projectId: "tripsplit-26993",
    storageBucket: "tripsplit-26993.firebasestorage.app",
    messagingSenderId: "675515854971",
    appId: "1:675515854971:web:b2fd518afaabe1ad0bf2de"
  },

  db: null,
  enabled: false,
  activeTripId: null,
  unsubscribers: [],
  status: 'offline', // 'offline' | 'connecting' | 'synced' | 'syncing' | 'error'
  initError: null,
  isLocalChange: false,

  // 清除物件中的 undefined 與非可序列化屬性，確保符合 Firestore 規範
  clean(obj) {
    if (!obj) return {};
    const c = JSON.parse(JSON.stringify(obj));
    delete c.attachments; // 排除大體積二進位圖檔
    return c;
  },

  async init() {
    this.initError = null;
    if (typeof firebase === 'undefined') {
      this.initError = 'Firebase SDK 尚未載入（請確認伺服器上 js/vendor/ 檔案已完整複製）';
      console.warn(this.initError);
      this.status = 'offline';
      this.enabled = false;
      this.updateUI();
      return;
    }
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(this.config);
      }
      this.db = firebase.firestore();
      try {
        this.db.settings({ ignoreUndefinedProperties: true });
      } catch {}
      this.enabled = true;
      this.status = 'synced';
      this.initError = null;
      this.updateUI();
    } catch (e) {
      this.initError = e.message || String(e);
      console.warn('Firebase 初始化失敗：', e);
      this.status = 'error';
      this.enabled = false;
      this.updateUI();
    }
  },

  updateUI() {
    const el = document.getElementById('cloudStatus');
    if (!el) return;
    const isShared = App?.trip?.isShared;
    if (!this.enabled) {
      el.className = 'cloud-status offline';
      el.innerHTML = '<span class="cloud-dot"></span> 離線模式';
      el.title = '尚未連線至 Firebase 雲端';
      return;
    }
    if (!isShared) {
      el.className = 'cloud-status local';
      el.innerHTML = '<span class="cloud-dot"></span> 本機儲存';
      el.title = '目前行程僅保存在此裝置，點擊開啟共享';
      return;
    }
    if (this.status === 'syncing') {
      el.className = 'cloud-status syncing';
      el.innerHTML = '<span class="cloud-dot pulse"></span> 正在同步...';
      el.title = '正在與雲端同步資料';
    } else if (this.status === 'error') {
      el.className = 'cloud-status error';
      el.innerHTML = '<span class="cloud-dot"></span> 同步異常';
      el.title = '雲端連線失敗，請檢查網路';
    } else {
      el.className = 'cloud-status synced';
      el.innerHTML = '<span class="cloud-dot"></span> 即時共享中 ☁️';
      el.title = '已與雲端連線，多人即時同步中';
    }
  },

  remoteChangeTimer: null,
  pendingChanges: new Set(),

  onRemoteChange(type) {
    if (this.isLocalChange) return;
    this.pendingChanges.add(type);
    clearTimeout(this.remoteChangeTimer);
    this.remoteChangeTimer = setTimeout(async () => {
      const types = Array.from(this.pendingChanges).join('、');
      this.pendingChanges.clear();
      await App.reload();
      const modal = document.getElementById('modal');
      if (!modal || modal.hidden) {
        App.go(App.page);
      }
      App.msg(`已即時同步雲端最新${types}資料 ☁️`);
    }, 300);
  },

  // 開啟或切換當前行程的即時訂閱
  subscribe(tripId) {
    this.unsubscribe();
    if (!this.enabled || !tripId) return;

    this.activeTripId = tripId;
    const tripRef = this.db.collection('shared_trips').doc(tripId);

    // 1. 監聽 Trip 自身
    let isFirstTrip = true;
    const unsubTrip = tripRef.onSnapshot(doc => {
      if (!doc.exists) return;
      if (doc.metadata.hasPendingWrites) return;
      const t = doc.data();
      DB.put('trips', t).then(() => {
        if (!isFirstTrip) this.onRemoteChange('行程');
        isFirstTrip = false;
        if (App.trip?.id === tripId) {
          App.trip = t;
          App.nav();
        }
      });
    }, err => console.warn('Trip sync error:', err));
    this.unsubscribers.push(unsubTrip);

    // 2. 監聽成員 members
    let isFirstMembers = true;
    const unsubMembers = tripRef.collection('members').onSnapshot(async snap => {
      if (snap.metadata.hasPendingWrites) return;
      let hasChange = false;
      for (const ch of snap.docChanges()) {
        if (!isFirstMembers || ch.type === 'modified') hasChange = true;
        if (ch.type === 'removed') {
          await DB.del('members', ch.doc.id);
        } else {
          await DB.put('members', ch.doc.data());
        }
      }
      if (!isFirstMembers && hasChange) this.onRemoteChange('成員');
      isFirstMembers = false;
    }, err => console.warn('Members sync error:', err));
    this.unsubscribers.push(unsubMembers);

    // 3. 監聽帳目 expenses
    let isFirstExpenses = true;
    const unsubExpenses = tripRef.collection('expenses').onSnapshot(async snap => {
      if (snap.metadata.hasPendingWrites) return;
      let hasChange = false;
      for (const ch of snap.docChanges()) {
        if (!isFirstExpenses || ch.type === 'modified') hasChange = true;
        if (ch.type === 'removed') {
          await DB.del('expenses', ch.doc.id);
        } else {
          await DB.put('expenses', ch.doc.data());
        }
      }
      if (!isFirstExpenses && hasChange) this.onRemoteChange('帳目');
      isFirstExpenses = false;
    }, err => console.warn('Expenses sync error:', err));
    this.unsubscribers.push(unsubExpenses);

    // 4. 監聽結算 settlements
    let isFirstSettlements = true;
    const unsubSettlements = tripRef.collection('settlements').onSnapshot(async snap => {
      if (snap.metadata.hasPendingWrites) return;
      let hasChange = false;
      for (const ch of snap.docChanges()) {
        if (!isFirstSettlements || ch.type === 'modified') hasChange = true;
        if (ch.type === 'removed') {
          await DB.del('settlements', ch.doc.id);
        } else {
          await DB.put('settlements', ch.doc.data());
        }
      }
      if (!isFirstSettlements && hasChange) this.onRemoteChange('還款');
      isFirstSettlements = false;
    }, err => console.warn('Settlements sync error:', err));
    this.unsubscribers.push(unsubSettlements);

    // 5. 監聽匯率 exchangeRates
    let isFirstRates = true;
    const unsubRates = tripRef.collection('rates').onSnapshot(async snap => {
      if (snap.metadata.hasPendingWrites) return;
      let hasChange = false;
      for (const ch of snap.docChanges()) {
        if (!isFirstRates || ch.type === 'modified') hasChange = true;
        if (ch.type === 'removed') {
          await DB.del('exchangeRates', ch.doc.id);
        } else {
          await DB.put('exchangeRates', ch.doc.data());
        }
      }
      if (!isFirstRates && hasChange) this.onRemoteChange('匯率');
      isFirstRates = false;
    }, err => console.warn('Rates sync error:', err));
    this.unsubscribers.push(unsubRates);

    this.status = 'synced';
    this.updateUI();
  },

  unsubscribe() {
    this.unsubscribers.forEach(unsub => {
      try { unsub(); } catch {}
    });
    this.unsubscribers = [];
    this.activeTripId = null;
  },

  // 本地新增或更新時同步寫入雲端
  async put(store, item) {
    if (!this.enabled || !App.trip?.isShared) return;
    const tripId = App.trip.id;
    const tripRef = this.db.collection('shared_trips').doc(tripId);

    this.isLocalChange = true;
    try {
      const cleanData = this.clean(item);
      if (store === 'trips') {
        await tripRef.set(cleanData, { merge: true });
      } else if (store === 'members') {
        await tripRef.collection('members').doc(item.id).set(cleanData);
      } else if (store === 'expenses') {
        await tripRef.collection('expenses').doc(item.id).set(cleanData);
      } else if (store === 'settlements') {
        await tripRef.collection('settlements').doc(item.id).set(cleanData);
      } else if (store === 'exchangeRates') {
        await tripRef.collection('rates').doc(item.id).set(cleanData);
      }
    } catch (e) {
      console.warn('雲端寫入失敗：', e);
    } finally {
      setTimeout(() => { this.isLocalChange = false; }, 600);
    }
  },

  // 本地刪除時同步刪除雲端
  async del(store, id) {
    if (!this.enabled || !App.trip?.isShared) return;
    const tripId = App.trip.id;
    const tripRef = this.db.collection('shared_trips').doc(tripId);

    this.isLocalChange = true;
    try {
      if (store === 'trips') {
        await tripRef.delete();
      } else if (store === 'members') {
        await tripRef.collection('members').doc(id).delete();
      } else if (store === 'expenses') {
        await tripRef.collection('expenses').doc(id).delete();
      } else if (store === 'settlements') {
        await tripRef.collection('settlements').doc(id).delete();
      } else if (store === 'exchangeRates') {
        await tripRef.collection('rates').doc(id).delete();
      }
    } catch (e) {
      console.warn('雲端刪除失敗：', e);
    } finally {
      setTimeout(() => { this.isLocalChange = false; }, 600);
    }
  },

  // 一鍵將現有本機行程發佈至雲端共享
  async shareTrip(tripId) {
    if (!this.enabled) {
      await this.init();
    }
    if (!this.enabled) {
      throw Error(this.initError || '無法連線至雲端服務，請確認網路是否正常');
    }
    const trip = App.data.trips.find(x => x.id === tripId);
    if (!trip) throw Error('找不到此行程');

    this.status = 'syncing';
    this.updateUI();

    const tripRef = this.db.collection('shared_trips').doc(tripId);
    trip.isShared = true;
    trip.updatedAt = new Date().toISOString();

    // 批次上傳該行程的所有資料（經 clean 過濾）
    const batch = this.db.batch();
    batch.set(tripRef, this.clean(trip));

    const members = App.items('members');
    for (const m of members) {
      batch.set(tripRef.collection('members').doc(m.id), this.clean(m));
    }

    const expenses = App.items('expenses');
    for (const e of expenses) {
      batch.set(tripRef.collection('expenses').doc(e.id), this.clean(e));
    }

    const settlements = App.items('settlements');
    for (const s of settlements) {
      batch.set(tripRef.collection('settlements').doc(s.id), this.clean(s));
    }

    const rates = App.items('exchangeRates');
    for (const r of rates) {
      batch.set(tripRef.collection('rates').doc(r.id), this.clean(r));
    }

    await batch.commit();

    // 更新本地
    await DB.put('trips', trip);
    this.subscribe(tripId);

    return this.getShareUrl(tripId);
  },

  // 取得分享連結（確保以 index.html 為檔案路徑，避免 IIS/Web 伺服器目錄自動 301 重定向時把 ?trip= 參數吃掉）
  getShareUrl(tripId) {
    const url = new URL(window.location.href);
    let path = url.pathname;
    if (!path.endsWith('.html')) {
      if (!path.endsWith('/')) path += '/';
      path += 'index.html';
    }
    url.pathname = path;
    url.search = '?trip=' + encodeURIComponent(tripId);
    url.hash = '';
    return url.toString();
  },

  // 朋友透過行程代碼或連結加入
  async joinTrip(tripId) {
    if (!this.enabled) {
      await this.init();
    }
    if (!this.enabled) {
      throw Error(this.initError || '無法連線至雲端服務，請確認網路是否正常');
    }
    if (!tripId) throw Error('請輸入行程代碼');

    tripId = tripId.trim();
    // 支援直接貼入完整連結或含 trip= 的字串
    if (tripId.includes('trip=')) {
      const match = tripId.match(/trip=([^&#\s]+)/);
      if (match && match[1]) {
        tripId = decodeURIComponent(match[1]).trim();
      }
    }

    this.status = 'syncing';
    this.updateUI();

    const tripRef = this.db.collection('shared_trips').doc(tripId);
    const doc = await tripRef.get();
    if (!doc.exists) {
      this.status = 'synced';
      this.updateUI();
      throw Error('找不到此共享行程，請向發起人確認代碼或連結是否正確。');
    }

    const tripData = doc.data();
    tripData.isShared = true;
    await DB.put('trips', tripData);

    // 下載子集合
    const membersSnap = await tripRef.collection('members').get();
    for (const d of membersSnap.docs) {
      await DB.put('members', d.data());
    }

    const expensesSnap = await tripRef.collection('expenses').get();
    for (const d of expensesSnap.docs) {
      await DB.put('expenses', d.data());
    }

    const settlementsSnap = await tripRef.collection('settlements').get();
    for (const d of settlementsSnap.docs) {
      await DB.put('settlements', d.data());
    }

    const ratesSnap = await tripRef.collection('rates').get();
    for (const d of ratesSnap.docs) {
      await DB.put('exchangeRates', d.data());
    }

    await App.reload();
    App.trip = tripData;
    this.subscribe(tripId);
    App.go('dashboard');

    return tripData;
  }
};
