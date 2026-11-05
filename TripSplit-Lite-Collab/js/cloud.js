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
  subscriptionVersion: 0,
  collectionStores: {
    members: 'members',
    expenses: 'expenses',
    settlements: 'settlements',
    exchangeRates: 'rates',
    travelPlans: 'travelPlans'
  },

  // 清除物件中的 undefined 與非可序列化屬性，確保符合 Firestore 規範
  clean(obj) {
    if (!obj) return {};
    const c = JSON.parse(JSON.stringify(obj));
    delete c.attachments; // 排除大體積二進位圖檔
    return c;
  },

  async init() {
    if (this.enabled && this.db) return;
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
        // experimentalForceLongPolling 解決 iOS Safari 及公司網路封鎖 WebSockets / gRPC WebChannel 的問題
        this.db.settings({
          ignoreUndefinedProperties: true,
          experimentalForceLongPolling: true
        });
      } catch (e) {
        console.warn('Firestore 設定未能套用：', e);
      }
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
    } else if (this.activeTripId !== App.trip.id || this.status === 'connecting') {
      el.className = 'cloud-status syncing';
      el.innerHTML = '<span class="cloud-dot pulse"></span> 正在連線...';
      el.title = '正在恢復此行程的雲端訂閱';
    } else {
      el.className = 'cloud-status synced';
      el.innerHTML = '<span class="cloud-dot"></span> 即時共享中 ☁️';
      el.title = '已與雲端連線，多人即時同步中';
    }
  },

  remoteChangeTimer: null,
  pendingChanges: new Set(),

  onRemoteChange(type) {
    const version = this.subscriptionVersion;
    this.pendingChanges.add(type);
    clearTimeout(this.remoteChangeTimer);
    this.remoteChangeTimer = setTimeout(async () => {
      try {
        const types = Array.from(this.pendingChanges).join('、');
        this.pendingChanges.clear();
        await App.reload();
        if (version !== this.subscriptionVersion) return;
        const modal = document.getElementById('modal');
        if (!modal || modal.hidden) {
          App.go(App.page);
        }
        App.msg(`已即時同步雲端最新${types}資料 ☁️`);
      } catch (err) {
        if (version === this.subscriptionVersion) this.syncError(err);
      }
    }, 300);
  },

  syncError(err) {
    console.warn('雲端同步失敗：', err);
    this.status = 'error';
    this.initError = err.message || String(err);
    this.updateUI();
  },

  // 開啟或切換當前行程的即時訂閱
  subscribe(tripId) {
    this.unsubscribe();
    if (!this.enabled || !tripId) return;

    this.activeTripId = tripId;
    const version = this.subscriptionVersion;
    const isCurrent = () => version === this.subscriptionVersion;
    const tripRef = this.db.collection('shared_trips').doc(tripId);
    const ready = new Set();
    const markReady = (store, snap) => {
      if (!snap.metadata.fromCache) ready.add(store);
      if (ready.size === Object.keys(this.collectionStores).length + 1 && this.status !== 'error') {
        this.status = 'synced';
        this.updateUI();
      }
    };
    const onError = err => {
      if (isCurrent()) this.syncError(err);
    };
    this.status = 'connecting';
    this.initError = null;
    this.updateUI();

    // 1. 監聽 Trip 自身
    const unsubTrip = tripRef.onSnapshot({ includeMetadataChanges: true }, async doc => {
      if (!isCurrent() || !doc.exists) return;
      if (doc.metadata.hasPendingWrites) return;
      try {
        const t = { ...doc.data(), id: tripId, isShared: true };
        await DB.put('trips', t);
        if (!isCurrent()) return;
        if (App.trip?.id === tripId) {
          App.trip = t;
          App.nav();
        }
        this.onRemoteChange('行程');
        markReady('trips', doc);
      } catch (err) {
        onError(err);
      }
    }, onError);
    this.unsubscribers.push(unsubTrip);

    const labels = { members: '成員', expenses: '帳目', settlements: '還款', exchangeRates: '匯率', travelPlans: '旅遊計劃' };
    for (const [store, collection] of Object.entries(this.collectionStores)) {
      // 依序處理快照，避免較舊的非同步本機寫入覆蓋較新的資料。
      let queue = Promise.resolve();
      const unsub = tripRef.collection(collection).onSnapshot({ includeMetadataChanges: true }, snap => {
        queue = queue.then(async () => {
          if (!isCurrent() || snap.metadata.hasPendingWrites) return;
          const remoteIds = new Set(snap.docs.map(doc => doc.id));
          // 只有伺服器的完整快照可用來清除離線期間已被別人刪除的資料。
          if (!snap.metadata.fromCache) {
            const local = await DB.all(store);
            for (const item of local) {
              if (!isCurrent()) return;
              if (item.tripId === tripId && !remoteIds.has(item.id)) await DB.del(store, item.id);
            }
          }
          for (const doc of snap.docs) {
            if (!isCurrent()) return;
            await DB.put(store, { ...doc.data(), id: doc.id, tripId });
          }
          if (!isCurrent()) return;
          this.onRemoteChange(labels[store]);
          markReady(store, snap);
        }).catch(onError);
        return queue;
      }, onError);
      this.unsubscribers.push(unsub);
    }
  },

  // 主動測試 Firestore 伺服器讀取；此檢測不會寫入使用者資料。
  async testConnection() {
    if (typeof firebase === 'undefined') {
      return { ok: false, step: 'sdk', code: 'SDK_NOT_LOADED', message: 'Firebase SDK 尚未載入，請確認 js/vendor/ 檔案齊全' };
    }
    if (!this.enabled || !this.db) {
      await this.init();
    }
    if (!this.enabled || !this.db) {
      return { ok: false, step: 'init', code: 'INIT_FAILED', message: this.initError || '初始化失敗' };
    }
    if (App.trip?.isShared && (this.activeTripId !== App.trip.id || this.status === 'error')) {
      this.subscribe(App.trip.id);
    }

    const start = Date.now();
    try {
      // 測試讀取 shared_trips 集合
      await this.db.collection('shared_trips').limit(1).get({ source: 'server' });
      const latency = Date.now() - start;
      return { ok: true, latency, message: `連線正常（延遲 ${latency}ms）` };
    } catch (e) {
      const code = e.code || 'UNKNOWN';
      let message = e.message || String(e);
      if (code === 'permission-denied') {
        message = 'Firebase 安全規則拒絕存取（請至 Firebase 控制台將 Cloud Firestore 規則改為允許讀寫）';
      } else if (code === 'unavailable') {
        message = '網路無法連線至 Firestore 雲端伺服器（請檢查公司防火牆/代理伺服器或 Wi-Fi）';
      }
      return { ok: false, step: 'test', code, message };
    }
  },

  unsubscribe() {
    this.subscriptionVersion++;
    clearTimeout(this.remoteChangeTimer);
    this.pendingChanges.clear();
    this.unsubscribers.forEach(unsub => {
      try { unsub(); } catch {}
    });
    this.unsubscribers = [];
    this.activeTripId = null;
  },

  // 本地新增或更新時同步寫入雲端
  async put(store, item) {
    if (store !== 'trips' && !this.collectionStores[store]) return;
    if (!this.enabled || !this.db) throw Error('資料已存於本機，但雲端尚未連線，請重新連線後再儲存以同步');
    const tripId = store === 'trips' ? item.id : item.tripId;
    const tripRef = this.db.collection('shared_trips').doc(tripId);

    try {
      const cleanData = this.clean(item);
      if (store === 'trips') {
        await tripRef.set(cleanData, { merge: true });
      } else {
        await tripRef.collection(this.collectionStores[store]).doc(item.id).set(cleanData);
      }
    } catch (e) {
      this.syncError(e);
      throw Error('資料已存於本機，但雲端寫入失敗：' + (e.message || String(e)));
    }
  },

  // 本地刪除時同步刪除雲端
  async del(store, id, tripId = App.trip?.id) {
    if (store !== 'trips' && !this.collectionStores[store]) return;
    if (!this.enabled || !this.db) throw Error('本機資料已刪除，但雲端尚未連線，雲端刪除未完成');
    if (store === 'trips') tripId = id;
    const tripRef = this.db.collection('shared_trips').doc(tripId);

    try {
      if (store === 'trips') {
        await tripRef.delete();
      } else {
        await tripRef.collection(this.collectionStores[store]).doc(id).delete();
      }
    } catch (e) {
      this.syncError(e);
      throw Error('本機資料已刪除，但雲端刪除失敗：' + (e.message || String(e)));
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
    const localTrip = App.data.trips.find(x => x.id === tripId);
    if (!localTrip) throw Error('找不到此行程');
    const trip = { ...localTrip, isShared: true, updatedAt: new Date().toISOString() };

    const previousStatus = this.status;
    this.status = 'syncing';
    this.updateUI();

    const tripRef = this.db.collection('shared_trips').doc(tripId);

    // 批次上傳該行程的所有資料（經 clean 過濾）
    const batch = this.db.batch();
    batch.set(tripRef, this.clean(trip));

    for (const [store, collection] of Object.entries(this.collectionStores)) {
      for (const item of (App.data[store] || []).filter(x => x.tripId === tripId)) {
        batch.set(tripRef.collection(collection).doc(item.id), this.clean(item));
      }
    }

    try {
      await batch.commit();
    } catch (err) {
      this.syncError(err);
      throw err;
    }

    // 更新本地
    await DB.put('trips', trip);
    if (App.trip?.id === tripId) {
      App.trip = trip;
      this.subscribe(tripId);
    } else {
      this.status = previousStatus;
      this.updateUI();
    }

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

    const tripData = { ...doc.data(), id: tripId, isShared: true };
    await DB.put('trips', tripData);

    // 下載子集合
    for (const [store, collection] of Object.entries(this.collectionStores)) {
      const snap = await tripRef.collection(collection).get();
      for (const d of snap.docs) {
        await DB.put(store, { ...d.data(), id: d.id, tripId });
      }
    }

    await App.reload();
    App.trip = tripData;
    await App.rememberTrip();
    this.subscribe(tripId);
    App.go('dashboard');

    return tripData;
  }
};

// 頂層 const 不會成為 window 屬性；App 以此屬性判斷雲端功能是否存在。
window.Cloud = Cloud;
