const App = {
  trip: null,
  page: 'trips',
  currentMemberId: null,
  data: {},
  modalSave: null,
  modalMouseDown: null,

  async init() {
    try {
      await DB.open();
      await this.reload();
      document.querySelector('#boot')?.remove();
      document.querySelector('#app').hidden = false;
      this.bind();

      // 初始化 Firebase 雲端模組
      if (window.Cloud) {
        await Cloud.init();
      }

      // 檢查網址是否有分享參數 ?trip=...
      const urlParams = new URLSearchParams(window.location.search);
      const shareTripId = urlParams.get('trip');
      if (shareTripId && window.Cloud && Cloud.enabled) {
        try {
          const loadedTrip = await Cloud.joinTrip(shareTripId);
          window.history.replaceState({}, document.title, window.location.pathname);
          this.msg(`成功加入行程「${loadedTrip.name}」！☁️`);
          return;
        } catch (err) {
          this.msg('加入分享行程失敗：' + err.message);
        }
      }

      this.trip = this.data.trips.find(x => x.status !== 'archived') || null;
      if (this.trip && this.trip.isShared && window.Cloud) {
        Cloud.subscribe(this.trip.id);
      } else if (window.Cloud) {
        Cloud.updateUI();
      }
      this.go(this.trip ? 'dashboard' : 'trips');
    } catch (e) {
      const b = document.querySelector('#boot');
      if (b) b.textContent = '無法開啟本機資料庫：' + e.message;
    }
  },

  async saveItem(store, item) {
    await DB.put(store, item);
    if (window.Cloud && this.trip?.isShared) {
      await Cloud.put(store, item);
    }
  },

  async deleteItem(store, id) {
    await DB.del(store, id);
    if (window.Cloud && this.trip?.isShared) {
      await Cloud.del(store, id);
    }
  },

  async reload() {
    for (const s of DB.stores) this.data[s] = await DB.all(s);
    // 自動檢查並修復歷史帳目中因附加調整設為「無」卻誤計調整費的問題
    let repaired = false;
    for (const e of (this.data.expenses || [])) {
      if (e.adjustmentType === 'NONE' && (e.adjustmentAmountMinor > 0 || (e.shares || []).some(s => s.finalShareMinor !== s.baseShareMinor))) {
        e.adjustmentAmountMinor = 0;
        e.adjustmentValue = 0;
        if (e.shares) {
          e.shares.forEach(s => {
            s.adjustmentShareMinor = 0;
            s.finalShareMinor = s.baseShareMinor;
          });
        }
        await DB.put('expenses', e);
        repaired = true;
      }
    }
    if (repaired) {
      for (const s of DB.stores) this.data[s] = await DB.all(s);
    }
  },

  bind() {
    const quickAdd = document.getElementById('quickAdd');
    const btnShareTrip = document.getElementById('btnShareTrip');
    const cloudStatus = document.getElementById('cloudStatus');
    const modal = document.getElementById('modal');
    const modalForm = document.getElementById('modalForm');
    const tripBadge = document.getElementById('tripBadge');
    const view = document.getElementById('view');

    if (quickAdd) quickAdd.onclick = () => this.expenseModal();
    if (tripBadge) {
      tripBadge.onclick = () => this.go('trips');
      tripBadge.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') this.go('trips'); };
    }

    if (btnShareTrip) {
      btnShareTrip.onclick = () => {
        if (!this.trip) return;
        if (this.trip.isShared) {
          this.shareModal(this.trip.id);
        } else {
          this.startShareTrip(this.trip.id);
        }
      };
    }

    if (cloudStatus) {
      cloudStatus.onclick = () => {
        if (!this.trip) return this.go('trips');
        if (this.trip.isShared) {
          this.shareModal(this.trip.id);
        } else {
          this.startShareTrip(this.trip.id);
        }
      };
    }

    modal.addEventListener('mousedown', e => {
      this.modalMouseDown = e.target;
    });

    modal.addEventListener('click', e => {
      if (e.target === modal && this.modalMouseDown === modal) this.closeModal();
      if (e.target.closest('[data-close]')) this.closeModal();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !modal.hidden) this.closeModal();
    });

    modalForm.addEventListener('submit', async e => {
      e.preventDefault();
      this.clearModalErr();
      try {
        await this.modalSave?.();
        this.closeModal();
        await this.reload();
        this.go(this.page);
        this.msg('資料已儲存');
      } catch (x) {
        // 修正二：帳目錯誤在 Modal 內即時顯示，不需退出表單
        this.modalErr(x.message);
      }
    });

    // CSP-safe 事件委派 (消除 inline onclick)
    view.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const act = btn.dataset.action;
      const id = btn.dataset.id;
      if (act === 'tripModal') return this.tripModal();
      if (act === 'openTrip') return this.openTrip(id);
      if (act === 'deleteTrip') return this.deleteTrip(id);
      if (act === 'startShareTrip') return this.startShareTrip(id);
      if (act === 'shareModal') return this.shareModal(id);
      if (act === 'joinTripModal') return this.joinTripModal();
      if (act === 'memberModal') return this.memberModal();
      if (act === 'toggleMember') return this.toggleMember(id);
      if (act === 'expenseModal') return this.expenseModal(id);
      if (act === 'deleteExpense') return this.deleteExpense(id);
      if (act === 'rateModal') return this.rateModal();
      if (act === 'deleteRate') return this.deleteRate(id);
      if (act === 'exportData') return this.exportData();
      if (act === 'importClick') return document.getElementById('importFile')?.click();
      if (act === 'recordSettlement') return this.recordSettlement(btn.dataset);
      if (act === 'deleteSettlement') return this.deleteSettlement(id);
      if (act === 'settlementDetail') return this.settlementDetailModal(btn.dataset.currency);
      if (act === 'openMemberDetail') return this.go('memberDetail', id);
      if (act === 'go') return this.go(btn.dataset.p, btn.dataset.id);
    });

    view.addEventListener('change', e => {
      if (e.target && e.target.id === 'importFile' && e.target.files?.[0]) {
        this.importData(e.target.files[0]);
      }
    });
  },

  items(s) {
    return (this.data[s] || []).filter(x => x.tripId === this.trip?.id);
  },

  esc(s = '') {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  },

  fmt(v, c) {
    const cur = c || this.trip?.defaultCurrency || 'HKD';
    try {
      return new Intl.NumberFormat('zh-Hant', {
        style: 'currency',
        currency: cur,
        minimumFractionDigits: Money.digits(cur)
      }).format(Money.toMajor(v || 0, cur));
    } catch {
      return `${cur} ${Money.toMajor(v || 0, cur).toFixed(Money.digits(cur))}`;
    }
  },

  msg(s, t = '') {
    const message = document.getElementById('message');
    if (!message) return;
    message.innerHTML = `<div class="notice ${t}">${this.esc(s)}</div>`;
    setTimeout(() => { message.innerHTML = ''; }, 3500);
  },

  modalErr(s) {
    const n = document.getElementById('modalNotice');
    if (!n) return;
    n.textContent = s;
    n.hidden = false;
    n.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  clearModalErr() {
    const n = document.getElementById('modalNotice');
    if (!n) return;
    n.textContent = '';
    n.hidden = true;
  },

  nav() {
    const desktopNav = document.getElementById('desktopNav');
    const mobileNav = document.getElementById('mobileNav');
    const all = [
      ['dashboard', '總覽'],
      ['expenses', '帳目'],
      ['settlements', '結算'],
      ['analytics', '統計'],
      ['members', '成員'],
      ['rates', '匯率'],
      ['trips', '行程'],
      ['settings', '設定']
    ];
    desktopNav.innerHTML = all.map(x =>
      `<button data-p="${x[0]}" class="${(this.page === x[0] || (this.page === 'memberDetail' && x[0] === 'analytics')) ? 'active' : ''}">${x[1]}</button>`
    ).join('');

    // 修正一：手機底部導覽 [總覽, 帳目, 結算, 行程, 更多]
    const isMoreActive = ['more', 'members', 'analytics', 'rates', 'settings', 'memberDetail'].includes(this.page);
    mobileNav.innerHTML = [
      ['dashboard', '總覽', this.page === 'dashboard'],
      ['expenses', '帳目', this.page === 'expenses'],
      ['settlements', '結算', this.page === 'settlements'],
      ['trips', '行程', this.page === 'trips'],
      ['more', '更多', isMoreActive]
    ].map(x => `<button data-p="${x[0]}" class="${x[2] ? 'active' : ''}">${x[1]}</button>`).join('');

    document.querySelectorAll('[data-p]').forEach(b => {
      b.onclick = () => this.go(b.dataset.p);
    });
  },

  go(p, arg) {
    if (p === 'memberDetail') {
      this.currentMemberId = arg || this.currentMemberId || this.items('members')[0]?.id;
    }
    if (!this.trip && !['trips', 'settings', 'more'].includes(p)) p = 'trips';
    this.page = p;
    this.nav();
    const tripBadge = document.getElementById('tripBadge');
    const quickAdd = document.getElementById('quickAdd');
    const btnShareTrip = document.getElementById('btnShareTrip');

    tripBadge.textContent = this.trip ? `${this.trip.name} · ${this.trip.defaultCurrency}${this.trip.isShared ? ' (☁️)' : ''}` : '尚未選擇行程 (點擊切換)';
    quickAdd.hidden = !this.trip || ['trips', 'settings', 'more'].includes(p);

    if (btnShareTrip) {
      btnShareTrip.hidden = !this.trip || ['trips', 'settings', 'more'].includes(p);
      btnShareTrip.textContent = this.trip?.isShared ? '📤 邀請/分享' : '☁️ 共享行程';
    }
    if (window.Cloud) {
      Cloud.updateUI();
    }

    const routes = {
      trips: () => this.trips(),
      dashboard: () => this.dashboard(),
      expenses: () => this.expenses(),
      members: () => this.members(),
      rates: () => this.rates(),
      settlements: () => this.settlements(),
      analytics: () => this.analytics(),
      settings: () => this.settings(),
      more: () => this.more(),
      memberDetail: () => this.memberDetail(this.currentMemberId)
    };
    (routes[p] || routes.trips)();
  },

  head(t, s) {
    document.getElementById('title').textContent = t;
    document.getElementById('subtitle').textContent = s;
  },

  show(h) {
    document.getElementById('view').innerHTML = h;
  },

  openModal(t, h, save) {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    this.clearModalErr();
    modalTitle.textContent = t;
    modalBody.innerHTML = h;
    this.modalSave = save;

    const submitBtn = modal.querySelector('.dialog-actions button.primary');
    const cancelBtn = modal.querySelector('.dialog-actions button[data-close]');
    if (submitBtn) submitBtn.hidden = !save;
    if (cancelBtn) cancelBtn.textContent = save ? '取消' : '關閉';

    modal.hidden = false;
    modal.classList.add('show');
    document.body.classList.add('modal-open');
    setTimeout(() => modal.querySelector('input,select,textarea')?.focus(), 50);
  },

  closeModal() {
    const modal = document.getElementById('modal');
    this.clearModalErr();
    modal.classList.remove('show');
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    this.modalSave = null;

    const submitBtn = modal.querySelector('.dialog-actions button.primary');
    const cancelBtn = modal.querySelector('.dialog-actions button[data-close]');
    if (submitBtn) submitBtn.hidden = false;
    if (cancelBtn) cancelBtn.textContent = '取消';
  },

  // 修正一：手機「更多」入口頁面（含成員、統計、匯率、行程、設定）
  more() {
    this.head('更多功能', '管理成員、統計分析、匯率、行程切換與資料備份');
    this.show(`
      <div class="menu-grid">
        <div class="menu-card" data-action="${this.trip?.isShared ? 'shareModal' : 'startShareTrip'}" data-id="${this.trip?.id}">
          <div class="menu-icon">☁️</div>
          <div class="menu-info">
            <b>${this.trip?.isShared ? '雲端共享與分享連結' : '開啟雲端多人協同'}</b>
            <small>${this.trip?.isShared ? '檢視專屬分享連結、QR Code 與即時同步狀態' : '將目前行程上傳至雲端，與朋友即時共同記帳'}</small>
          </div>
        </div>
        <div class="menu-card" data-action="go" data-p="members">
          <div class="menu-icon">👥</div>
          <div class="menu-info">
            <b>成員管理</b>
            <small>建立及管理虛擬同行者名單與啟用狀態</small>
          </div>
        </div>
        <div class="menu-card" data-action="go" data-p="analytics">
          <div class="menu-icon">📊</div>
          <div class="menu-info">
            <b>統計分析</b>
            <small>各幣別總額、分類圖表與每日成員消費總額</small>
          </div>
        </div>
        <div class="menu-card" data-action="go" data-p="memberDetail">
          <div class="menu-icon">👤</div>
          <div class="menu-info">
            <b>成員消費詳細頁</b>
            <small>按成員逐筆檢視個人分攤、代墊金額與每日明細</small>
          </div>
        </div>
        <div class="menu-card" data-action="go" data-p="rates">
          <div class="menu-icon">💱</div>
          <div class="menu-info">
            <b>每日匯率</b>
            <small>管理多幣別換算率，原幣及預設幣結算</small>
          </div>
        </div>
        <div class="menu-card" data-action="go" data-p="trips">
          <div class="menu-icon">🗺️</div>
          <div class="menu-info">
            <b>行程管理</b>
            <small>切換目前行程、建立新行程或管理舊行程</small>
          </div>
        </div>
        <div class="menu-card" data-action="go" data-p="settings">
          <div class="menu-icon">⚙️</div>
          <div class="menu-info">
            <b>設定與備份</b>
            <small>完整 JSON 資料匯出備份與還原功能</small>
          </div>
        </div>
      </div>
    `);
  },

  trips() {
    this.head('我的行程', '可隨時切換、建立新行程或加入朋友共享的行程');
    const rows = (this.data.trips || []).map(t => `
      <div class="row">
        <div>
          <b>${this.esc(t.name)} ${t.isShared ? '<span class="tag-shared">☁️ 雲端共享</span>' : ''}</b>
          <div class="muted">${t.startDate || '未設定日期'} · ${t.defaultCurrency}</div>
        </div>
        <div>
          ${t.isShared ? `<button class="secondary btn-sm" data-action="shareModal" data-id="${t.id}" title="分享行程連結" style="margin-right:4px">📤 分享</button>` : `<button class="secondary btn-sm" data-action="startShareTrip" data-id="${t.id}" title="轉為雲端多人共享" style="margin-right:4px">☁️ 共享</button>`}
          <button class="primary btn-sm" data-action="openTrip" data-id="${t.id}">開啟</button>
          <button class="danger btn-sm" data-action="deleteTrip" data-id="${t.id}">刪除</button>
        </div>
      </div>
    `).join('');

    this.show(`
      <div class="toolbar" style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="primary" data-action="tripModal">＋ 建立行程</button>
        <button class="secondary" data-action="joinTripModal">🔗 輸入代碼加入行程</button>
      </div>
      ${rows ? `<div class="card">${rows}</div>` : `
        <div class="empty">
          <h2>尚未建立行程</h2>
          <p>建立第一個行程以開始記錄分帳，或輸入朋友的代碼加入共享行程。</p>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:12px">
            <button class="primary" data-action="tripModal">建立行程</button>
            <button class="secondary" data-action="joinTripModal">🔗 加入朋友的行程</button>
          </div>
        </div>
      `}
    `);
  },

  async startShareTrip(id) {
    const tripId = id || this.trip?.id;
    if (!tripId) return;
    if (!confirm('是否將此行程發佈至雲端開啟多人即時協同共享？\n（同行朋友可用專屬連結或代碼即時共同編輯）')) return;

    try {
      this.msg('正在上傳行程至雲端... ☁️');
      await Cloud.shareTrip(tripId);
      await this.reload();
      if (this.trip?.id === tripId) {
        this.trip = this.data.trips.find(x => x.id === tripId);
      }
      this.shareModal(tripId);
      this.msg('行程已成功發佈至雲端共享！☁️');
    } catch (e) {
      alert('開啟雲端共享失敗：' + e.message);
    }
  },

  shareModal(id) {
    const tripId = id || this.trip?.id;
    const t = this.data.trips.find(x => x.id === tripId);
    if (!t) return;
    const shareUrl = Cloud.getShareUrl(tripId);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}`;

    this.openModal(`☁️ 分享行程「${this.esc(t.name)}」`, `
      <div class="share-box">
        <label><b>專屬加入連結</b>（點擊右側按鈕複製）</label>
        <div class="share-url-row">
          <input id="shareUrlInput" class="share-url-input" value="${this.esc(shareUrl)}" readonly>
          <button type="button" class="primary btn-sm" id="btnCopyShareUrl">複製連結</button>
        </div>
      </div>

      <div class="share-box">
        <label><b>行程代碼 (Trip ID)</b></label>
        <div class="share-url-row">
          <input id="shareIdInput" class="share-url-input" value="${this.esc(tripId)}" readonly>
          <button type="button" class="btn-sm" id="btnCopyShareId">複製代碼</button>
        </div>
      </div>

      <div class="share-qr-wrap">
        <p class="muted" style="margin-bottom:8px"><b>📱 手機掃描 QR Code 即可加入</b></p>
        <img src="${qrUrl}" alt="QR Code" class="share-qr-img" onerror="this.style.display='none'">
        <p class="muted" style="font-size:12px;margin-top:8px">朋友打開連結即可即時同步查看與新增帳目，免安裝、免註冊！</p>
      </div>
    `, null);

    setTimeout(() => {
      const btnCopyUrl = document.getElementById('btnCopyShareUrl');
      const inputUrl = document.getElementById('shareUrlInput');
      if (btnCopyUrl && inputUrl) {
        btnCopyUrl.onclick = () => {
          inputUrl.select();
          navigator.clipboard?.writeText(inputUrl.value).then(() => {
            btnCopyUrl.textContent = '已複製！✓';
            setTimeout(() => { btnCopyUrl.textContent = '複製連結'; }, 2000);
          }).catch(() => {
            document.execCommand('copy');
            btnCopyUrl.textContent = '已複製！✓';
          });
        };
      }

      const btnCopyId = document.getElementById('btnCopyShareId');
      const inputId = document.getElementById('shareIdInput');
      if (btnCopyId && inputId) {
        btnCopyId.onclick = () => {
          inputId.select();
          navigator.clipboard?.writeText(inputId.value).then(() => {
            btnCopyId.textContent = '已複製！✓';
            setTimeout(() => { btnCopyId.textContent = '複製代碼'; }, 2000);
          }).catch(() => {
            document.execCommand('copy');
            btnCopyId.textContent = '已複製！✓';
          });
        };
      }
    }, 50);
  },

  joinTripModal() {
    this.openModal('🔗 加入朋友的共享行程', `
      <div class="form-grid">
        <div class="field full">
          <label>請輸入朋友分享的「行程連結」或「行程代碼」*</label>
          <input id="fJoinCode" placeholder="貼上完整連結或例如 8e4f1a2b-..." autofocus>
          <small class="muted" style="margin-top:6px;display:block">貼上朋友分享給你的連結或代碼，系統將從雲端即時載入完整行程。</small>
        </div>
      </div>
    `, async () => {
      const fJoinCode = document.getElementById('fJoinCode');
      const val = fJoinCode?.value?.trim();
      if (!val) throw Error('請輸入行程代碼或分享連結');
      const trip = await Cloud.joinTrip(val);
      this.msg(`成功加入行程「${trip.name}」！☁️`);
    });
  },

  tripModal() {
    this.openModal('建立行程', `
      <div class="form-grid">
        <div class="field full">
          <label>行程名稱 *</label>
          <input id="fName" placeholder="例如：東京五天四夜">
        </div>
        <div class="field">
          <label>開始日期</label>
          <input id="fStart" type="date">
        </div>
        <div class="field">
          <label>結束日期</label>
          <input id="fEnd" type="date">
        </div>
        <div class="field">
          <label>預設貨幣</label>
          <select id="fCurrency">
            <option value="HKD">HKD - 港幣</option>
            <option value="JPY">JPY - 日圓</option>
            <option value="TWD">TWD - 新台幣</option>
            <option value="USD">USD - 美元</option>
            <option value="EUR">EUR - 歐元</option>
            <option value="CNY">CNY - 人民幣</option>
          </select>
        </div>
      </div>
    `, async () => {
      const fName = document.getElementById('fName');
      const fStart = document.getElementById('fStart');
      const fEnd = document.getElementById('fEnd');
      const fCurrency = document.getElementById('fCurrency');

      if (!fName.value.trim()) throw Error('請輸入行程名稱');
      if (fEnd.value && fStart.value && fEnd.value < fStart.value) {
        throw Error('結束日期不可早於開始日期');
      }
      const n = new Date().toISOString();
      const o = {
        id: uid(),
        name: fName.value.trim(),
        startDate: fStart.value,
        endDate: fEnd.value,
        defaultCurrency: fCurrency.value,
        status: 'active',
        isShared: false,
        createdAt: n,
        updatedAt: n
      };
      await this.saveItem('trips', o);
      this.trip = o;
      if (window.Cloud) {
        Cloud.unsubscribe();
        Cloud.updateUI();
      }
      this.page = 'dashboard';
    });
  },

  async openTrip(id) {
    this.trip = this.data.trips.find(x => x.id === id);
    if (window.Cloud) {
      if (this.trip && this.trip.isShared) {
        Cloud.subscribe(this.trip.id);
      } else {
        Cloud.unsubscribe();
        Cloud.updateUI();
      }
    }
    this.go('dashboard');
  },

  async deleteTrip(id) {
    if (!confirm('確定刪除此行程及其所有相關帳目與成員資料？')) return;
    const target = this.data.trips.find(x => x.id === id);
    const isShared = target?.isShared;

    for (const s of DB.stores) {
      for (const x of (this.data[s] || [])) {
        if (x.tripId === id) await DB.del(s, x.id);
      }
    }
    await DB.del('trips', id);
    if (isShared && window.Cloud) {
      await Cloud.del('trips', id);
    }
    if (this.trip?.id === id) {
      Cloud?.unsubscribe?.();
      await this.reload();
      this.trip = this.data.trips.find(x => x.status !== 'archived') || null;
      if (this.trip?.isShared && window.Cloud) {
        Cloud.subscribe(this.trip.id);
      }
    }
    await this.reload();
    this.go(this.trip ? 'dashboard' : 'trips');
    this.msg('行程已刪除');
  },

  balances(currency = this.trip?.defaultCurrency || 'HKD') {
    const allMembers = this.items('members');
    const b = Object.fromEntries(allMembers.map(x => [x.id, 0]));

    for (const e of this.items('expenses').filter(x => x.currency === currency)) {
      for (const p of e.payers) b[p.memberId] = (b[p.memberId] || 0) + p.amountMinor;
      for (const s of e.shares) b[s.memberId] = (b[s.memberId] || 0) - s.finalShareMinor;
    }

    for (const s of this.items('settlements').filter(x => x.currency === currency)) {
      b[s.fromMemberId] = (b[s.fromMemberId] || 0) + s.amountMinor;
      b[s.toMemberId] = (b[s.toMemberId] || 0) - s.amountMinor;
    }

    // 額外修正：包含所有啟用成員，以及有未結清餘額的停用成員，確保加總必為 0
    return allMembers
      .filter(m => m.isActive || (b[m.id] && b[m.id] !== 0))
      .map(m => ({
        memberId: m.id,
        name: m.name + (m.isActive ? '' : ' (已停用)'),
        amount: b[m.id] || 0
      }));
  },

  dashboard() {
    this.head(this.trip.name, '旅行分帳概況');
    const es = this.items('expenses');
    const names = Object.fromEntries(this.items('members').map(x => [x.id, x.name]));
    const currencies = [...new Set(es.map(x => x.currency))];
    if (this.trip && !currencies.includes(this.trip.defaultCurrency)) {
      currencies.unshift(this.trip.defaultCurrency);
    }

    // 總花費：彙總有支出的幣別
    const spendList = currencies.map(c => {
      const sum = es.filter(e => e.currency === c).reduce((a, e) => a + e.finalAmountMinor, 0);
      return sum > 0 ? this.fmt(sum, c) : null;
    }).filter(Boolean);
    const totalDisplay = spendList.length ? spendList.join(' + ') : this.fmt(0, this.trip.defaultCurrency);

    // 跨幣別收集所有建議結算與非零成員淨額
    const allSuggestions = [];
    const balancesList = [];
    currencies.forEach(c => {
      const b = this.balances(c);
      const nonZero = b.filter(x => x.amount !== 0);
      if (nonZero.length) {
        balancesList.push({ currency: c, balances: b });
      }
      const s = Debt.suggest(b);
      s.forEach(item => {
        allSuggestions.push({ ...item, currency: c });
      });
    });

    if (!balancesList.length) {
      balancesList.push({ currency: this.trip.defaultCurrency, balances: this.balances(this.trip.defaultCurrency) });
    }

    this.show(`
      ${this.trip.isShared ? `
        <div class="cloud-banner">
          <div>☁️ <b>雲端即時協同中</b>：同行朋友的新增或修改將自動同步至此裝置。</div>
          <button class="primary btn-sm" data-action="shareModal" data-id="${this.trip.id}">📤 分享連結 / QR Code</button>
        </div>
      ` : `
        <div class="cloud-banner local-hint">
          <div>💡 <b>目前為本機離線行程</b>：想與同行朋友一起即時記帳？</div>
          <button class="secondary btn-sm" data-action="startShareTrip" data-id="${this.trip.id}">☁️ 開啟雲端多人共享</button>
        </div>
      `}
      <div class="cards">
        <div class="card metric">
          <small>總花費金額</small>
          <strong style="font-size:${spendList.length > 1 ? '18px' : '24px'}">${totalDisplay}</strong>
        </div>
        <div class="card metric">
          <small>帳目數量</small>
          <strong>${es.length}</strong>
        </div>
        <div class="card metric">
          <small>成員數量</small>
          <strong>${this.items('members').filter(x => x.isActive).length}</strong>
        </div>
        <div class="card metric">
          <small>幣別數量</small>
          <strong>${new Set(es.map(x => x.currency)).size}</strong>
        </div>
      </div>
      <div class="grid">
        <div class="card">
          <h2>最近帳目</h2>
          ${es.slice().sort((a, b) => b.expenseDate.localeCompare(a.expenseDate)).slice(0, 8).map(e => `
            <div class="row">
              <div>
                <b>${this.esc(e.name)}</b>
                <div class="muted">${e.expenseDate} · ${e.category}</div>
              </div>
              <b>${this.fmt(e.finalAmountMinor, e.currency)}</b>
            </div>
          `).join('') || '<p class="muted">尚未有帳目。</p>'}
        </div>
        <div>
          <div class="card">
            <h2>成員淨額</h2>
            ${balancesList.map(item => `
              ${balancesList.length > 1 ? `<div class="muted" style="margin:8px 0 3px;font-size:12px;font-weight:700">${item.currency}</div>` : ''}
              ${item.balances.map(x => `
                <div class="row">
                  <b>${this.esc(x.name)}</b>
                  <strong class="${x.amount >= 0 ? 'positive' : 'negative'}">${this.fmt(x.amount, item.currency)}</strong>
                </div>
              `).join('')}
            `).join('') || '<p class="muted">請先新增成員。</p>'}
          </div>
          <div class="card settle" style="margin-top:14px">
            <h2>建議結算</h2>
            ${allSuggestions.map(x => `
              <div class="row">
                <span>${this.esc(names[x.from] || x.from)} → ${this.esc(names[x.to] || x.to)}</span>
                <b>${this.fmt(x.amount, x.currency)}</b>
              </div>
            `).join('') || '<p>沒有待結算餘額。</p>'}
          </div>
        </div>
      </div>
    `);
  },

  members() {
    this.head('成員管理', '建立及停用虛擬同行者');
    this.show(`
      <div class="toolbar">
        <button class="primary" data-action="memberModal">＋ 新增成員</button>
      </div>
      <div class="card">
        ${this.items('members').map(m => `
          <div class="row">
            <div>
              <b>${this.esc(m.name)}</b>
              <span class="pill">${m.isActive ? '啟用' : '停用'}</span>
              ${m.notes ? `<div class="muted">${this.esc(m.notes)}</div>` : ''}
            </div>
            <div>
              <button class="btn-sm" data-action="openMemberDetail" data-id="${m.id}" style="margin-right:6px">詳細帳目</button>
              <button class="btn-sm" data-action="toggleMember" data-id="${m.id}">${m.isActive ? '停用' : '啟用'}</button>
            </div>
          </div>
        `).join('') || '<p class="muted">尚未有成員。</p>'}
      </div>
    `);
  },

  memberModal() {
    this.openModal('新增成員', `
      <div class="form-grid">
        <div class="field full">
          <label>名稱 *</label>
          <input id="fName" placeholder="例如：小明">
        </div>
        <div class="field full">
          <label>備註</label>
          <textarea id="fNotes" rows="2" placeholder="選填"></textarea>
        </div>
      </div>
    `, async () => {
      const fName = document.getElementById('fName');
      const fNotes = document.getElementById('fNotes');
      const name = fName.value.trim();
      if (!name) throw Error('請輸入成員名稱');
      if (this.items('members').some(x => x.isActive && x.name.toLowerCase() === name.toLowerCase())) {
        throw Error('已有相同名稱的啟用成員');
      }
      const n = new Date().toISOString();
      await this.saveItem('members', {
        id: uid(),
        tripId: this.trip.id,
        name,
        notes: fNotes.value.trim(),
        isActive: true,
        createdAt: n,
        updatedAt: n
      });
    });
  },

  async toggleMember(id) {
    const m = this.data.members.find(x => x.id === id);
    if (!m) return;
    m.isActive = !m.isActive;
    m.updatedAt = new Date().toISOString();
    await this.saveItem('members', m);
    await this.reload();
    this.go('members');
  },

  expenses() {
    this.head('帳目記錄', '新增、修改及刪除旅行支出');
    const es = this.items('expenses').slice().sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
    this.show(`
      <div class="toolbar">
        <button class="primary" data-action="expenseModal">＋ 新增帳目</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>名稱</th>
              <th>分類</th>
              <th>貨幣</th>
              <th>金額</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${es.map(e => `
              <tr>
                <td>${e.expenseDate}</td>
                <td>${this.esc(e.name)}</td>
                <td>${e.category}</td>
                <td>${e.currency}</td>
                <td>${this.fmt(e.finalAmountMinor, e.currency)}</td>
                <td>
                  <button class="btn-sm" data-action="expenseModal" data-id="${e.id}">修改</button>
                  <button class="danger btn-sm" data-action="deleteExpense" data-id="${e.id}">刪除</button>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="6" style="text-align:center;padding:24px" class="muted">尚未有帳目。</td></tr>'}
          </tbody>
        </table>
      </div>
    `);
  },

  // 階段一：交易輸入與分帳核心邏輯
  expenseModal(id) {
    const old = this.data.expenses.find(x => x.id === id);
    const ms = this.items('members').filter(x => x.isActive || old?.shares.some(s => s.memberId === x.id));
    if (!ms.length) {
      this.msg('請先新增成員', 'warn');
      this.go('members');
      return;
    }
    const cur = old?.currency || this.trip.defaultCurrency || 'HKD';
    const shareMap = Object.fromEntries((old?.shares || []).map(x => [x.memberId, x]));
    const defaultSplit = old?.splitMethod || 'EQUAL';

    // 支援金額 ($) 與 百分比 (%) 兩種附加調整模式
    const adjMode = old?.adjustmentMode || 'AMOUNT';
    let adjValueDisplay = '';
    if (old) {
      if (old.adjustmentValue !== undefined && old.adjustmentValue !== null) {
        adjValueDisplay = old.adjustmentValue;
      } else {
        adjValueDisplay = Money.toMajor(old.adjustmentAmountMinor || 0, cur);
      }
    } else {
      adjValueDisplay = '0';
    }

    this.openModal(old ? '修改帳目' : '新增帳目', `
      <div class="form-grid">
        <div class="field full">
          <label>名稱 *</label>
          <input id="fName" value="${this.esc(old?.name || '')}" placeholder="例如：居酒屋晚餐">
        </div>
        <div class="field">
          <label>日期 *</label>
          <input id="fDate" type="date" value="${old?.expenseDate || new Date().toISOString().slice(0, 10)}">
        </div>
        <div class="field">
          <label>分類</label>
          <select id="fCategory">
            ${['餐飲', '交通', '住宿', '景點', '購物', '雜項'].map(x => `<option ${old?.category === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>貨幣</label>
          <select id="fCurrency">
            ${['HKD', 'JPY', 'TWD', 'USD', 'EUR', 'CNY'].map(x => `<option value="${x}" ${cur === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>基礎金額 *</label>
          <input id="fAmount" type="number" step="${Money.digits(cur) === 0 ? '1' : '0.01'}" min="0" value="${old ? Money.toMajor(old.baseAmountMinor, cur) : ''}" placeholder="0.00">
        </div>
        <div class="field">
          <label>分攤方式</label>
          <select id="fSplit">
            ${[['EQUAL', '均分'], ['EXACT', '精確金額'], ['SHARES', '份數'], ['PERCENTAGE', '百分比']].map(x => `
              <option value="${x[0]}" ${defaultSplit === x[0] ? 'selected' : ''}>${x[1]}</option>
            `).join('')}
          </select>
        </div>

        <!-- 2. 附加調整支援金額與百分比 -->
        <div class="field">
          <label>附加調整</label>
          <select id="fAdjType">
            ${[['NONE', '無'], ['ADDITIVE_TAX', '外加稅／服務費 (+)'], ['REFUND', '退稅 (-)']].map(x => `
              <option value="${x[0]}" ${old?.adjustmentType === x[0] ? 'selected' : ''}>${x[1]}</option>
            `).join('')}
          </select>
        </div>
        <div class="field">
          <label>
            <span id="adjLabel">${adjMode === 'PERCENTAGE' ? '調整百分比 (%)' : '調整金額'}</span>
            <span class="toggle-mode-group">
              <button type="button" class="toggle-mode ${adjMode === 'AMOUNT' ? 'active' : ''}" id="btnAdjModeAmt">$ 金額</button>
              <button type="button" class="toggle-mode ${adjMode === 'PERCENTAGE' ? 'active' : ''}" id="btnAdjModePct">% 百分比</button>
            </span>
          </label>
          <input type="hidden" id="fAdjMode" value="${adjMode}">
          <input id="fAdj" type="number" min="0" step="${adjMode === 'PERCENTAGE' ? '0.01' : (Money.digits(cur) === 0 ? '1' : '0.01')}" value="${adjValueDisplay}" placeholder="${adjMode === 'PERCENTAGE' ? '例如：10 (代表 10%)' : '0.00'}">
          <div id="adjCalcHint" class="muted" style="font-size:12px;margin-top:2px;min-height:16px;"></div>
        </div>

        <!-- 修正三：付款人金額按最終金額自動填入及平衡 -->
        <div class="field full">
          <label>
            <span>付款人及付款金額</span>
            <div class="split-actions">
              <button type="button" class="btn-xs" id="btnPayerAuto">均分付款</button>
              <button type="button" class="btn-xs" id="btnPayerRemain">填入剩餘</button>
            </div>
          </label>
          <div id="payerList">
            ${ms.map((m, idx) => {
              const p = old?.payers.find(x => x.memberId === m.id);
              const isChecked = p || (!old && idx === 0);
              return `
                <div class="payer-line">
                  <label>
                    <input class="payerCheck" type="checkbox" value="${m.id}" ${isChecked ? 'checked' : ''}>
                    <span>${this.esc(m.name)}</span>
                  </label>
                  <input class="payerValue" data-id="${m.id}" type="number" min="0" step="${Money.digits(cur) === 0 ? '1' : '0.01'}" value="${p ? Money.toMajor(p.amountMinor, cur) : ''}" placeholder="0.00">
                </div>
              `;
            }).join('')}
          </div>
          <div id="payerStatus" class="balance-status"></div>
        </div>

        <!-- 1. 精確金額分帳優化與分攤成員 -->
        <div class="field full">
          <label>
            <span>分攤成員及輸入值</span>
            <div class="split-actions">
              <button type="button" class="btn-xs" id="btnShareSplit">自動平衡分攤</button>
            </div>
          </label>
          <div id="shareList">
            ${ms.map(m => {
              const s = shareMap[m.id];
              return `
                <div class="member-line">
                  <label>
                    <input class="shareCheck" type="checkbox" value="${m.id}" ${s || !old ? 'checked' : ''}>
                    <span>${this.esc(m.name)}</span>
                  </label>
                  <input class="shareValue" data-id="${m.id}" type="number" step="${Money.digits(cur) === 0 ? '1' : '0.01'}" value="${old?.splitMethod === 'EXACT' && s ? Money.toMajor(s.baseShareMinor, cur) : s?.inputValue || 1}">
                </div>
              `;
            }).join('')}
          </div>
          <div id="shareStatus" class="balance-status"></div>
        </div>
      </div>
    `, async () => {
      // 驗證並儲存
      const fName = document.getElementById('fName');
      const fDate = document.getElementById('fDate');
      const fCategory = document.getElementById('fCategory');
      const fCurrency = document.getElementById('fCurrency');
      const fAmount = document.getElementById('fAmount');
      const fSplit = document.getElementById('fSplit');
      const fAdjType = document.getElementById('fAdjType');
      const fAdj = document.getElementById('fAdj');
      const fAdjMode = document.getElementById('fAdjMode');

      const currency = fCurrency.value;
      const base = Money.toMinor(fAmount.value, currency);
      const isPct = fAdjMode.value === 'PERCENTAGE';
      const adjVal = Number(fAdj.value || 0);
      const type = fAdjType.value;
      const adj = (type === 'NONE') ? 0 : (isPct ? Math.round(base * adjVal / 100) : Money.toMinor(adjVal, currency));
      const final = base + (type === 'ADDITIVE_TAX' ? adj : type === 'REFUND' ? -adj : 0);

      if (!fName.value.trim()) throw Error('請輸入帳目名稱');
      if (!fDate.value) throw Error('請選擇日期');
      if (base <= 0) throw Error('基礎金額必須大於零');
      if (final < 0) throw Error('最終金額不可小於零');

      const checkedShares = [...document.querySelectorAll('.shareCheck:checked')];
      if (!checkedShares.length) throw Error('請至少選擇一位分攤成員');

      const inputs = checkedShares.map(x => ({
        memberId: x.value,
        value: fSplit.value === 'EXACT'
          ? Money.toMinor(document.querySelector(`.shareValue[data-id="${x.value}"]`).value, currency)
          : Number(document.querySelector(`.shareValue[data-id="${x.value}"]`).value)
      }));

      // 精確分帳檢查防呆
      if (fSplit.value === 'EXACT') {
        const negativeShare = inputs.find(x => x.value < 0);
        if (negativeShare) {
          throw Error('精確分攤金額不可為負數，請調低前面成員的金額');
        }
        const exactSum = inputs.reduce((a, b) => a + b.value, 0);
        if (exactSum !== base) {
          throw Error(`精確分攤總和 (${Money.toMajor(exactSum, currency)}) 必須等於基礎金額 (${Money.toMajor(base, currency)})`);
        }
      }

      const payers = [...document.querySelectorAll('.payerCheck:checked')].map(x => ({
        memberId: x.value,
        amountMinor: Money.toMinor(document.querySelector(`.payerValue[data-id="${x.value}"]`).value, currency)
      }));
      if (!payers.length) throw Error('請至少選擇一位付款人');

      const payerSum = payers.reduce((a, b) => a + b.amountMinor, 0);
      if (payerSum !== final) {
        throw Error(`付款人金額總和 (${Money.toMajor(payerSum, currency)}) 必須等於最終金額 (${Money.toMajor(final, currency)})`);
      }

      const n = new Date().toISOString();
      const e = {
        id: old?.id || uid(),
        tripId: this.trip.id,
        expenseDate: fDate.value,
        name: fName.value.trim(),
        category: fCategory.value,
        currency,
        baseAmountMinor: base,
        adjustmentType: type,
        adjustmentMode: fAdjMode.value,
        adjustmentValue: adjVal,
        adjustmentAmountMinor: adj,
        finalAmountMinor: final,
        splitMethod: fSplit.value,
        payers,
        createdAt: old?.createdAt || n,
        updatedAt: n
      };

      e.shares = Money.shares(e, inputs).map((x, i) => ({
        ...x,
        inputValue: inputs[i].value
      }));

      await this.saveItem('expenses', e);
    });

    // 綁定 Modal 內部即時計算與自動平衡
    this.bindExpenseModalInteractions(cur, !old);
  },

  bindExpenseModalInteractions(initialCur, isNew) {
    const fCurrency = document.getElementById('fCurrency');
    const fAmount = document.getElementById('fAmount');
    const fAdjType = document.getElementById('fAdjType');
    const fAdj = document.getElementById('fAdj');
    const fAdjMode = document.getElementById('fAdjMode');
    const btnAdjModeAmt = document.getElementById('btnAdjModeAmt');
    const btnAdjModePct = document.getElementById('btnAdjModePct');
    const adjLabel = document.getElementById('adjLabel');
    const adjCalcHint = document.getElementById('adjCalcHint');

    const fSplit = document.getElementById('fSplit');
    const btnPayerAuto = document.getElementById('btnPayerAuto');
    const btnPayerRemain = document.getElementById('btnPayerRemain');
    const btnShareSplit = document.getElementById('btnShareSplit');
    const payerStatus = document.getElementById('payerStatus');
    const shareStatus = document.getElementById('shareStatus');

    // 切換調整模式 ($ 金額 與 % 百分比)
    btnAdjModeAmt.onclick = () => {
      if (fAdjMode.value === 'AMOUNT') return;
      const cur = fCurrency.value;
      const baseMinor = Money.toMinor(fAmount.value || 0, cur);
      const pct = Number(fAdj.value || 0);
      const convertedMinor = Math.round(baseMinor * pct / 100);
      fAdjMode.value = 'AMOUNT';
      btnAdjModeAmt.classList.add('active');
      btnAdjModePct.classList.remove('active');
      adjLabel.textContent = '調整金額';
      fAdj.step = Money.digits(cur) === 0 ? '1' : '0.01';
      fAdj.placeholder = '0.00';
      fAdj.value = convertedMinor > 0 ? Money.toMajor(convertedMinor, cur) : 0;
      updateCalculations('adjMode');
    };

    btnAdjModePct.onclick = () => {
      if (fAdjMode.value === 'PERCENTAGE') return;
      const cur = fCurrency.value;
      const baseMinor = Money.toMinor(fAmount.value || 0, cur);
      const amtMinor = Money.toMinor(fAdj.value || 0, cur);
      let pct = 0;
      if (baseMinor > 0 && amtMinor > 0) {
        pct = Math.round((amtMinor / baseMinor) * 10000) / 100;
      }
      fAdjMode.value = 'PERCENTAGE';
      btnAdjModePct.classList.add('active');
      btnAdjModeAmt.classList.remove('active');
      adjLabel.textContent = '調整百分比 (%)';
      fAdj.step = '0.01';
      fAdj.placeholder = '例如：10 (代表 10%)';
      fAdj.value = pct > 0 ? pct : '';
      updateCalculations('adjMode');
    };

    const getAdjustmentAmountMinor = () => {
      const cur = fCurrency.value;
      const baseMinor = Money.toMinor(fAmount.value || 0, cur);
      const isPct = fAdjMode.value === 'PERCENTAGE';
      let adjMinor = 0;
      if (isPct) {
        const pct = Number(fAdj.value || 0);
        adjMinor = Math.round(baseMinor * pct / 100);
        if (adjCalcHint) {
          adjCalcHint.innerHTML = (pct > 0 && baseMinor > 0) ? `折算金額：<b>${this.fmt(adjMinor, cur)}</b> (${pct}%)` : '';
        }
      } else {
        adjMinor = Money.toMinor(fAdj.value || 0, cur);
        if (adjCalcHint) adjCalcHint.innerHTML = '';
      }
      return adjMinor;
    };

    const getFinalAmountMinor = () => {
      const cur = fCurrency.value;
      const base = Money.toMinor(fAmount.value || 0, cur);
      const adj = getAdjustmentAmountMinor();
      const type = fAdjType.value;
      return Math.max(0, base + (type === 'ADDITIVE_TAX' ? adj : type === 'REFUND' ? -adj : 0));
    };

    // 精確分帳：自動計算最後一位成員金額
    const autoCalcLastExactMember = (changedSource) => {
      if (fSplit.value !== 'EXACT') return;
      const cur = fCurrency.value;
      const baseMinor = Money.toMinor(fAmount.value || 0, cur);
      const checkedShares = [...document.querySelectorAll('.shareCheck:checked')];
      if (checkedShares.length === 1) {
        const singleInp = document.querySelector(`.shareValue[data-id="${checkedShares[0].value}"]`);
        if (singleInp && changedSource !== 'shareManual_last') {
          singleInp.value = Money.toMajor(baseMinor, cur);
        }
        return;
      }
      if (checkedShares.length < 2) return;

      const lastTarget = checkedShares[checkedShares.length - 1];
      const otherShares = checkedShares.slice(0, -1);

      if (changedSource !== 'shareManual_last') {
        const sumPreMinor = otherShares.reduce((s, chk) => {
          const val = document.querySelector(`.shareValue[data-id="${chk.value}"]`)?.value;
          return s + Money.toMinor(val || 0, cur);
        }, 0);
        const remainMinor = baseMinor - sumPreMinor;
        const lastInp = document.querySelector(`.shareValue[data-id="${lastTarget.value}"]`);
        if (lastInp) {
          lastInp.value = Money.toMajor(remainMinor, cur);
        }
      }
    };

    const updateCalculations = (changedSource) => {
      const cur = fCurrency.value;
      const finalMinor = getFinalAmountMinor();
      const baseMinor = Money.toMinor(fAmount.value || 0, cur);
      const checkedPayers = [...document.querySelectorAll('.payerCheck:checked')];

      // 付款人自動連動（單人自動填入全額）
      if (['amount', 'currency', 'adj', 'adjMode'].includes(changedSource) && checkedPayers.length === 1) {
        const inp = document.querySelector(`.payerValue[data-id="${checkedPayers[0].value}"]`);
        if (inp) inp.value = finalMinor > 0 ? Money.toMajor(finalMinor, cur) : '';
      }

      // 計算付款人總額與差額
      const payerSumMinor = checkedPayers.reduce((s, chk) => {
        const val = document.querySelector(`.payerValue[data-id="${chk.value}"]`)?.value;
        return s + Money.toMinor(val || 0, cur);
      }, 0);
      const payerDiffMinor = finalMinor - payerSumMinor;

      if (payerStatus) {
        if (payerDiffMinor === 0 && finalMinor > 0) {
          payerStatus.className = 'balance-status balanced';
          payerStatus.innerHTML = `<span>最終金額：<b>${this.fmt(finalMinor, cur)}</b> | 付款總計：<b>${this.fmt(payerSumMinor, cur)}</b></span> <span>平衡 ✓</span>`;
        } else {
          payerStatus.className = 'balance-status unbalanced';
          const diffStr = payerDiffMinor > 0 ? `尚欠 ${this.fmt(payerDiffMinor, cur)}` : `超出 ${this.fmt(-payerDiffMinor, cur)}`;
          payerStatus.innerHTML = `<span>最終金額：<b>${this.fmt(finalMinor, cur)}</b> | 付款總計：<b>${this.fmt(payerSumMinor, cur)}</b></span> <span>${diffStr} ⚠️</span>`;
        }
      }

      // 計算分攤狀態
      const split = fSplit.value;
      const checkedShares = [...document.querySelectorAll('.shareCheck:checked')];

      if (split === 'EXACT') {
        autoCalcLastExactMember(changedSource);
      }

      if (shareStatus) {
        if (split === 'EQUAL') {
          const perPerson = checkedShares.length ? Math.round(baseMinor / checkedShares.length) : 0;
          shareStatus.className = 'balance-status balanced';
          shareStatus.innerHTML = `<span>均分模式：每人基礎約 <b>${this.fmt(perPerson, cur)}</b>（共 ${checkedShares.length} 人）</span> <span>自動均分 ✓</span>`;
          document.querySelectorAll('.shareValue').forEach(inp => { inp.disabled = true; });
        } else {
          document.querySelectorAll('.shareValue').forEach(inp => { inp.disabled = false; });
          if (split === 'PERCENTAGE') {
            const sumPct = checkedShares.reduce((s, chk) => {
              const val = Number(document.querySelector(`.shareValue[data-id="${chk.value}"]`)?.value || 0);
              return s + val;
            }, 0);
            const diffPct = 100 - sumPct;
            if (Math.abs(diffPct) < 0.001) {
              shareStatus.className = 'balance-status balanced';
              shareStatus.innerHTML = `<span>分攤百分比總計：<b>100%</b></span> <span>平衡 ✓</span>`;
            } else {
              shareStatus.className = 'balance-status unbalanced';
              shareStatus.innerHTML = `<span>分攤百分比總計：<b>${sumPct.toFixed(2)}%</b></span> <span>${diffPct > 0 ? `尚欠 ${diffPct.toFixed(2)}%` : `超出 ${(-diffPct).toFixed(2)}%`} ⚠️</span>`;
            }
          } else if (split === 'EXACT') {
            const sumExactMinor = checkedShares.reduce((s, chk) => {
              const val = document.querySelector(`.shareValue[data-id="${chk.value}"]`)?.value;
              return s + Money.toMinor(val || 0, cur);
            }, 0);
            const diffExact = baseMinor - sumExactMinor;

            // 檢查是否有成員為負數
            let hasNegative = false;
            checkedShares.forEach(chk => {
              const inp = document.querySelector(`.shareValue[data-id="${chk.value}"]`);
              if (inp) {
                const valMinor = Money.toMinor(inp.value || 0, cur);
                if (valMinor < 0) {
                  hasNegative = true;
                  inp.classList.add('input-error');
                } else {
                  inp.classList.remove('input-error');
                }
              }
            });

            if (hasNegative) {
              shareStatus.className = 'balance-status unbalanced';
              shareStatus.innerHTML = `<span>⚠️ 前面輸入金額已超過基礎金額 (${this.fmt(baseMinor, cur)})，最後成員金額小於 0！</span>`;
            } else if (diffExact === 0 && baseMinor > 0) {
              shareStatus.className = 'balance-status balanced';
              shareStatus.innerHTML = `<span>精確分攤總計：<b>${this.fmt(sumExactMinor, cur)}</b>（最後一人已自動平衡帶入）</span> <span>平衡 ✓</span>`;
            } else {
              shareStatus.className = 'balance-status unbalanced';
              shareStatus.innerHTML = `<span>基礎金額：<b>${this.fmt(baseMinor, cur)}</b> | 分攤總計：<b>${this.fmt(sumExactMinor, cur)}</b></span> <span>${diffExact > 0 ? `尚欠 ${this.fmt(diffExact, cur)}` : `超出 ${this.fmt(-diffExact, cur)}`} ⚠️</span>`;
            }
          } else {
            const sumShares = checkedShares.reduce((s, chk) => {
              const val = Number(document.querySelector(`.shareValue[data-id="${chk.value}"]`)?.value || 0);
              return s + val;
            }, 0);
            shareStatus.className = 'balance-status balanced';
            shareStatus.innerHTML = `<span>總份數：<b>${sumShares} 份</b>（共 ${checkedShares.length} 人參與）</span>`;
          }
        }
      }
    };

    // 均分付款按鈕
    btnPayerAuto.onclick = () => {
      const cur = fCurrency.value;
      const finalMinor = getFinalAmountMinor();
      const checked = [...document.querySelectorAll('.payerCheck:checked')];
      if (!checked.length) return;
      const allocated = Money.allocate(finalMinor, checked.map(() => 1));
      checked.forEach((chk, i) => {
        const inp = document.querySelector(`.payerValue[data-id="${chk.value}"]`);
        if (inp) inp.value = Money.toMajor(allocated[i], cur);
      });
      updateCalculations('payerManual');
    };

    // 填入剩餘付款按鈕
    btnPayerRemain.onclick = () => {
      const cur = fCurrency.value;
      const finalMinor = getFinalAmountMinor();
      const checked = [...document.querySelectorAll('.payerCheck:checked')];
      if (!checked.length) return;
      const target = checked[checked.length - 1];
      const otherSumMinor = checked.slice(0, -1).reduce((s, chk) => {
        const val = document.querySelector(`.payerValue[data-id="${chk.value}"]`)?.value;
        return s + Money.toMinor(val || 0, cur);
      }, 0);
      const remainMinor = Math.max(0, finalMinor - otherSumMinor);
      const inp = document.querySelector(`.payerValue[data-id="${target.value}"]`);
      if (inp) inp.value = Money.toMajor(remainMinor, cur);
      updateCalculations('payerManual');
    };

    // 分攤自動平衡按鈕
    btnShareSplit.onclick = () => {
      const cur = fCurrency.value;
      const baseMinor = Money.toMinor(fAmount.value || 0, cur);
      const split = fSplit.value;
      const checked = [...document.querySelectorAll('.shareCheck:checked')];
      if (!checked.length) return;

      if (split === 'PERCENTAGE') {
        const eachPct = (100 / checked.length);
        let rem = 100;
        checked.forEach((chk, idx) => {
          const inp = document.querySelector(`.shareValue[data-id="${chk.value}"]`);
          if (inp) {
            const val = (idx === checked.length - 1) ? Number(rem.toFixed(2)) : Number(eachPct.toFixed(2));
            rem -= val;
            inp.value = val;
          }
        });
      } else if (split === 'EXACT') {
        const allocated = Money.allocate(baseMinor, checked.map(() => 1));
        checked.forEach((chk, i) => {
          const inp = document.querySelector(`.shareValue[data-id="${chk.value}"]`);
          if (inp) inp.value = Money.toMajor(allocated[i], cur);
        });
      } else if (split === 'SHARES') {
        checked.forEach(chk => {
          const inp = document.querySelector(`.shareValue[data-id="${chk.value}"]`);
          if (inp) inp.value = 1;
        });
      }
      updateCalculations('shareManual');
    };

    // 付款人核取方塊切換
    document.querySelectorAll('.payerCheck').forEach(chk => {
      chk.onchange = () => {
        const cur = fCurrency.value;
        const finalMinor = getFinalAmountMinor();
        const inp = document.querySelector(`.payerValue[data-id="${chk.value}"]`);
        const checked = [...document.querySelectorAll('.payerCheck:checked')];

        if (chk.checked) {
          if (checked.length === 1) {
            if (inp) inp.value = Money.toMajor(finalMinor, cur);
          } else {
            // 自動計算剩餘未付金額填入
            const otherSum = checked.filter(x => x !== chk).reduce((s, c) => {
              const val = document.querySelector(`.payerValue[data-id="${c.value}"]`)?.value;
              return s + Money.toMinor(val || 0, cur);
            }, 0);
            const remain = Math.max(0, finalMinor - otherSum);
            if (inp && (!inp.value || Number(inp.value) === 0)) {
              inp.value = remain > 0 ? Money.toMajor(remain, cur) : '';
            }
          }
        } else {
          if (inp) inp.value = '';
          if (checked.length === 1) {
            const singleInp = document.querySelector(`.payerValue[data-id="${checked[0].value}"]`);
            if (singleInp) singleInp.value = Money.toMajor(finalMinor, cur);
          }
        }
        updateCalculations('payerToggle');
      };
    });

    // 分攤成員核取方塊切換
    document.querySelectorAll('.shareCheck').forEach(chk => {
      chk.onchange = () => updateCalculations('shareToggle');
    });

    // 監聽金額與幣別變更
    fAmount.oninput = () => updateCalculations('amount');
    fAdj.oninput = () => updateCalculations('adj');
    fAdjType.onchange = () => updateCalculations('adj');
    fCurrency.onchange = () => {
      const cur = fCurrency.value;
      const step = Money.digits(cur) === 0 ? '1' : '0.01';
      fAmount.step = step;
      if (fAdjMode.value === 'AMOUNT') fAdj.step = step;
      document.querySelectorAll('.payerValue').forEach(inp => { inp.step = step; });
      updateCalculations('currency');
    };

    fSplit.onchange = () => {
      const split = fSplit.value;
      const checked = [...document.querySelectorAll('.shareCheck:checked')];
      if (split === 'PERCENTAGE') {
        // 切換至百分比時自動平分 100%
        btnShareSplit.click();
      } else if (split === 'EXACT') {
        // 切換至精確金額時自動均分基礎金額
        btnShareSplit.click();
      } else if (split === 'SHARES') {
        checked.forEach(chk => {
          const inp = document.querySelector(`.shareValue[data-id="${chk.value}"]`);
          if (inp) inp.value = 1;
        });
      }
      updateCalculations('splitChange');
    };

    document.querySelectorAll('.payerValue').forEach(inp => {
      inp.oninput = () => updateCalculations('payerManual');
    });

    // 監聽精確分帳輸入，精確判定最後一位輸入
    document.querySelectorAll('.shareValue').forEach(inp => {
      inp.oninput = () => {
        const checkedShares = [...document.querySelectorAll('.shareCheck:checked')];
        const lastTarget = checkedShares[checkedShares.length - 1];
        const isLast = (lastTarget && lastTarget.value === inp.dataset.id);
        updateCalculations(isLast ? 'shareManual_last' : 'shareManual');
      };
    });

    // 初始化若是新增帳目且已有金額，先自動觸發一次平衡
    if (isNew) {
      updateCalculations('amount');
    } else {
      updateCalculations('init');
    }
  },

  async deleteExpense(id) {
    if (!confirm('確定刪除此帳目？')) return;
    await this.deleteItem('expenses', id);
    await this.reload();
    this.go('expenses');
    this.msg('帳目已刪除');
  },

  rates() {
    this.head('每日匯率', '手動保存來源貨幣到行程預設貨幣的匯率');
    const rs = this.items('exchangeRates');
    this.show(`
      <div class="toolbar">
        <button class="primary" data-action="rateModal">＋ 新增匯率</button>
      </div>
      <div class="card">
        ${rs.map(r => `
          <div class="row">
            <div>
              <b>${r.rateDate} · ${r.fromCurrency} → ${r.toCurrency}</b>
              <div class="muted">1 ${r.fromCurrency} = ${r.rate} ${r.toCurrency}</div>
            </div>
            <button class="danger btn-sm" data-action="deleteRate" data-id="${r.id}">刪除</button>
          </div>
        `).join('') || '<p class="muted">尚未有匯率資料。</p>'}
      </div>
    `);
  },

  rateModal() {
    this.openModal('新增每日匯率', `
      <div class="form-grid">
        <div class="field">
          <label>日期 *</label>
          <input id="fDate" type="date" value="${new Date().toISOString().slice(0, 10)}">
        </div>
        <div class="field">
          <label>來源貨幣</label>
          <select id="fFrom">
            <option>JPY</option>
            <option>USD</option>
            <option>TWD</option>
            <option>EUR</option>
            <option>CNY</option>
            <option>HKD</option>
          </select>
        </div>
        <div class="field">
          <label>目標貨幣</label>
          <input id="fTo" value="${this.trip.defaultCurrency}" readonly>
        </div>
        <div class="field">
          <label>匯率 *</label>
          <input id="fRate" type="number" step="0.000001" placeholder="例如：0.0512">
        </div>
      </div>
    `, async () => {
      const fDate = document.getElementById('fDate');
      const fFrom = document.getElementById('fFrom');
      const fTo = document.getElementById('fTo');
      const fRate = document.getElementById('fRate');
      if (!fDate.value || Number(fRate.value) <= 0) {
        throw Error('請輸入有效日期及大於零的匯率');
      }
      await this.saveItem('exchangeRates', {
        id: uid(),
        tripId: this.trip.id,
        rateDate: fDate.value,
        fromCurrency: fFrom.value,
        toCurrency: fTo.value,
        rate: Number(fRate.value),
        createdAt: new Date().toISOString()
      });
    });
  },

  async deleteRate(id) {
    if (!confirm('確定刪除此匯率記錄？')) return;
    await this.deleteItem('exchangeRates', id);
    await this.reload();
    this.go('rates');
    this.msg('匯率已刪除');
  },

  // 階段三：結算頁面優化（建議結算、沖銷還款與結算詳情入口）
  settlements() {
    this.head('結算方案', '按貨幣分開顯示實用簡化方案與結算沖銷');
    const currencies = [...new Set(this.items('expenses').map(x => x.currency))];
    if (this.trip && !currencies.includes(this.trip.defaultCurrency)) {
      currencies.unshift(this.trip.defaultCurrency);
    }
    const names = Object.fromEntries(this.items('members').map(x => [x.id, x.name]));
    const recordedSettlements = this.items('settlements').slice().sort((a, b) => (b.settlementDate || b.createdAt || '').localeCompare(a.settlementDate || a.createdAt || ''));

    const currencySections = currencies.map(c => {
      const b = this.balances(c);
      const s = Debt.suggest(b);
      return `
        <div class="grid" style="margin-bottom:20px">
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <h2 style="margin:0">${c} 成員餘額</h2>
              <button class="btn-sm" data-action="settlementDetail" data-currency="${c}">📊 結算詳情與推導</button>
            </div>
            ${b.map(x => `
              <div class="row">
                <b>${this.esc(x.name)}</b>
                <strong class="${x.amount >= 0 ? 'positive' : 'negative'}">${this.fmt(x.amount, c)}</strong>
              </div>
            `).join('') || '<p class="muted">無餘額數據。</p>'}
          </div>
          <div class="card settle">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <h2 style="margin:0">${c} 建議轉帳</h2>
            </div>
            ${s.map(x => `
              <div class="row">
                <span>${this.esc(names[x.from] || x.from)} → ${this.esc(names[x.to] || x.to)}</span>
                <div>
                  <b style="margin-right:8px">${this.fmt(x.amount, c)}</b>
                  <button class="primary btn-xs" data-action="recordSettlement" data-from="${x.from}" data-to="${x.to}" data-amount="${x.amount}" data-currency="${c}">記錄已還款</button>
                </div>
              </div>
            `).join('') || '<p>此幣別已結清，沒有待結算項目。</p>'}
          </div>
        </div>
      `;
    }).join('');

    const settlementHistory = `
      <div class="card" style="margin-top:20px">
        <h2>已記錄還款紀錄</h2>
        ${recordedSettlements.map(r => `
          <div class="row">
            <div>
              <b>${this.esc(names[r.fromMemberId] || r.fromMemberId)}</b> 已還給 <b>${this.esc(names[r.toMemberId] || r.toMemberId)}</b>
              <div class="muted">${r.settlementDate || r.createdAt?.slice(0, 10)} · 沖銷還款</div>
            </div>
            <div>
              <b style="margin-right:10px">${this.fmt(r.amountMinor, r.currency)}</b>
              <button class="danger btn-sm" data-action="deleteSettlement" data-id="${r.id}">撤銷</button>
            </div>
          </div>
        `).join('') || '<p class="muted">尚未有已記錄的還款紀錄。</p>'}
      </div>
    `;

    this.show(currencySections ? (currencySections + settlementHistory) : '<div class="empty">尚未有帳目可供結算。</div>');
  },

  // 6. 結算詳情 Modal（展示原始交易、淨額統計與演算法推導過程）
  settlementDetailModal(currency) {
    const es = this.items('expenses').filter(x => x.currency === currency);
    const ms = this.items('members');
    const names = Object.fromEntries(ms.map(x => [x.id, x.name]));
    const b = this.balances(currency);
    const explanation = Debt.explain(b);

    // 計算每人付款、分攤與沖銷還款總額
    const memberSummary = ms.map(m => {
      let paid = 0;
      let shared = 0;
      let settled = 0;

      es.forEach(e => {
        const p = e.payers.find(x => x.memberId === m.id);
        if (p) paid += p.amountMinor;
        const s = e.shares.find(x => x.memberId === m.id);
        if (s) shared += s.finalShareMinor;
      });

      this.items('settlements').filter(x => x.currency === currency).forEach(st => {
        if (st.fromMemberId === m.id) settled += st.amountMinor;
        if (st.toMemberId === m.id) settled -= st.amountMinor;
      });

      const net = paid - shared + settled;
      return {
        memberId: m.id,
        name: m.name,
        paid,
        shared,
        settled,
        net
      };
    }).filter(x => x.paid !== 0 || x.shared !== 0 || x.settled !== 0);

    const sumPaid = memberSummary.reduce((a, b) => a + b.paid, 0);
    const sumShared = memberSummary.reduce((a, b) => a + b.shared, 0);
    const sumNet = memberSummary.reduce((a, b) => a + b.net, 0);

    const html = `
      <div style="padding:10px 18px 24px">
        <!-- 區塊一：收支淨額彙總 -->
        <h3 style="margin-top:0">一、${currency} 收支淨額彙總</h3>
        <p class="muted" style="font-size:12px;margin:-4px 0 10px">公式：淨額 = 總付款代墊 (+) － 總分攤應付 (－) ＋ 沖銷還款 (±)</p>
        
        ${sumNet !== 0 ? `
          <div style="background:#fff3cd;border:1px solid #ffeeba;color:#856404;padding:10px 14px;border-radius:6px;margin-bottom:12px;font-size:13px">
            ⚠️ <b>帳目借貸不平衡警告：</b><br>
            總付款代墊 (<b>${this.fmt(sumPaid, currency)}</b>) 與 總分攤應付 (<b>${this.fmt(sumShared, currency)}</b>) 存在 <b>${this.fmt(Math.abs(sumNet), currency)}</b> 差額！<br>
            這會導致結算推導後仍有剩餘未平。請檢查下方「涵蓋之原始消費項目」中標註有【⚠️ 不平衡】的帳目。
          </div>
        ` : ''}

        <div class="daily-table-wrap">
          <table class="daily-table">
            <thead>
              <tr>
                <th>成員</th>
                <th>總付款代墊 (+)</th>
                <th>總分攤應付 (－)</th>
                <th>沖銷還款 (±)</th>
                <th>最終淨額</th>
              </tr>
            </thead>
            <tbody>
              ${memberSummary.map(m => `
                <tr>
                  <td><b>${this.esc(m.name)}</b></td>
                  <td>${this.fmt(m.paid, currency)}</td>
                  <td>${this.fmt(m.shared, currency)}</td>
                  <td>${m.settled !== 0 ? (m.settled > 0 ? `+${this.fmt(m.settled, currency)}` : this.fmt(m.settled, currency)) : '-'}</td>
                  <td><b class="${m.net >= 0 ? 'positive' : 'negative'}">${this.fmt(m.net, currency)}</b></td>
                </tr>
              `).join('') || '<tr><td colspan="5" class="muted" style="text-align:center">無收支資料</td></tr>'}
            </tbody>
            <tfoot>
              <tr style="font-weight:bold;background:#f8fafc">
                <td>總計</td>
                <td>${this.fmt(sumPaid, currency)}</td>
                <td>${this.fmt(sumShared, currency)}</td>
                <td>-</td>
                <td class="${sumNet === 0 ? 'positive' : 'negative'}">${sumNet === 0 ? '平衡 ($0)' : this.fmt(sumNet, currency) + ' (差額)'}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- 區塊二：債務簡化計算推導過程 -->
        <h3 style="margin:20px 0 6px">二、債務簡化推導過程</h3>
        <p class="muted" style="font-size:12px;margin-bottom:12px">
          採用貪婪撮合演算法（Greedy Settlement）：將多角借貸按「最大債務人」優先向「最大債權人」進行撮合沖銷，以最少轉帳次數完成清算。
        </p>

        <div style="background:#f8fafc;padding:12px;border-radius:8px;border:1px solid var(--line);margin-bottom:14px;font-size:13px">
          <div><b>債權人 (應收)：</b>${explanation.creditors.map(c => `${this.esc(names[c.memberId] || c.memberId)} (${this.fmt(c.amount, currency)})`).join('、') || '無'}</div>
          <div style="margin-top:4px"><b>債務人 (應付)：</b>${explanation.debtors.map(d => `${this.esc(names[d.memberId] || d.memberId)} (${this.fmt(d.amount, currency)})`).join('、') || '無'}</div>
        </div>

        <div>
          ${explanation.steps.map(st => `
            <div class="step-item">
              <div class="step-num">${st.step}</div>
              <div class="step-content">
                <div><b>${this.esc(names[st.from] || st.from)}</b> 轉帳 <b>${this.fmt(st.amount, currency)}</b> 給 <b>${this.esc(names[st.to] || st.to)}</b></div>
                <div class="muted" style="font-size:12px;margin-top:2px">
                  ${this.esc(names[st.from] || st.from)} 尚欠 ${this.fmt(st.debtorOwedBefore, currency)} ➜ ${st.debtorCleared ? '<span class="positive">全數結清 ($0)</span>' : `尚欠 ${this.fmt(st.debtorRemaining, currency)}`}；
                  ${this.esc(names[st.to] || st.to)} 應收 ${this.fmt(st.creditorEntitledBefore, currency)} ➜ ${st.creditorCleared ? '<span class="positive">已收齊 ($0)</span>' : `尚餘應收 ${this.fmt(st.creditorRemaining, currency)}`}
                </div>
              </div>
            </div>
          `).join('') || '<p class="muted">目前債務已完全結清，無需任何轉帳步驟。</p>'}
        </div>

        <!-- 區塊三：涵蓋之原始消費明細清單 -->
        <h3 style="margin:20px 0 8px">三、涵蓋之原始消費項目 (${es.length} 筆)</h3>
        <div class="daily-table-wrap">
          <table class="daily-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>名稱 / 分類</th>
                <th>總金額</th>
                <th>付款人</th>
                <th>分攤細節</th>
              </tr>
            </thead>
            <tbody>
              ${es.map(e => {
                const pSum = e.payers.reduce((a, b) => a + b.amountMinor, 0);
                const sSum = e.shares.reduce((a, b) => a + b.finalShareMinor, 0);
                const isDiff = (pSum !== sSum);
                return `
                  <tr style="${isDiff ? 'background:#fff5f5' : ''}">
                    <td>${e.expenseDate}</td>
                    <td>
                      <b>${this.esc(e.name)}</b> <span class="pill">${e.category}</span>
                      ${isDiff ? `<div style="color:#dc2626;font-size:11px;font-weight:bold;margin-top:2px">⚠️ 付款(${this.fmt(pSum, currency)}) ≠ 分攤(${this.fmt(sSum, currency)})，差額：${this.fmt(sSum - pSum, currency)}</div>` : ''}
                    </td>
                    <td><b>${this.fmt(e.finalAmountMinor, currency)}</b></td>
                    <td>${e.payers.map(p => `${this.esc(names[p.memberId] || p.memberId)}: ${this.fmt(p.amountMinor, currency)}`).join('<br>')}</td>
                    <td style="font-size:12px">${e.shares.map(s => `${this.esc(names[s.memberId] || s.memberId)}: ${this.fmt(s.finalShareMinor, currency)}`).join('<br>')}</td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="5" class="muted" style="text-align:center">無消費項目</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.openModal(`結算詳情與推導 (${currency})`, html, async () => {
      // 僅供檢視，儲存即關閉
    });
  },

  async recordSettlement(dataset) {
    const fromId = dataset.from;
    const toId = dataset.to;
    const amountMinor = Number(dataset.amount);
    const currency = dataset.currency;
    const names = Object.fromEntries(this.items('members').map(x => [x.id, x.name]));
    const fromName = names[fromId] || fromId;
    const toName = names[toId] || toId;

    if (!confirm(`確定記錄「${fromName}」已還款給「${toName}」共 ${this.fmt(amountMinor, currency)}？`)) return;

    const n = new Date().toISOString();
    await this.saveItem('settlements', {
      id: uid(),
      tripId: this.trip.id,
      fromMemberId: fromId,
      toMemberId: toId,
      amountMinor,
      currency,
      settlementDate: n.slice(0, 10),
      createdAt: n
    });

    await this.reload();
    this.go('settlements');
    this.msg(`已記錄 ${fromName} 向 ${toName} 的還款`);
  },

  async deleteSettlement(id) {
    if (!confirm('確定撤銷這筆還款記錄？沖銷金額將恢復為待結算。')) return;
    await this.deleteItem('settlements', id);
    await this.reload();
    this.go('settlements');
    this.msg('還款記錄已撤銷');
  },

  // 階段二：統計分析頁（幣別分類與總計 + 每日每位成員消費總額）
  analytics() {
    this.head('統計分析', '各幣別總額、分類圖表與每日成員消費總額');
    const es = this.items('expenses');
    const ms = this.items('members').filter(m => m.isActive || es.some(e => e.shares.some(s => s.memberId === m.id)));
    const names = Object.fromEntries(this.items('members').map(x => [x.id, x.name]));

    // 3. 所有實際使用過的貨幣分類與金額總計
    let currencies = [...new Set(es.map(x => x.currency))];
    if (this.trip && !currencies.includes(this.trip.defaultCurrency)) {
      currencies.unshift(this.trip.defaultCurrency);
    }

    const currencyCards = currencies.map(c => {
      const curExpenses = es.filter(e => e.currency === c);
      const totalSpend = curExpenses.reduce((a, e) => a + e.finalAmountMinor, 0);

      const by = {};
      curExpenses.forEach(e => {
        by[e.category] = (by[e.category] || 0) + e.finalAmountMinor;
      });
      const max = Math.max(1, ...Object.values(by));

      return `
        <div class="card" style="margin-bottom:18px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div>
              <h2 style="margin:0">${c} 消費統計</h2>
              <span class="muted">${curExpenses.length} 筆帳目</span>
            </div>
            <strong style="font-size:22px;color:var(--p)">${this.fmt(totalSpend, c)}</strong>
          </div>
          <div class="chart">
            ${Object.entries(by).map(([k, v]) => `
              <div class="bar" style="height:${Math.max(8, v / max * 100)}%">
                <span>${k}<br>${this.fmt(v, c)}</span>
              </div>
            `).join('') || '<p class="muted" style="width:100%;text-align:center">此幣別尚無消費資料。</p>'}
          </div>
        </div>
      `;
    }).join('');

    // 4. 每日每位成員消費總額
    const allDates = [...new Set(es.map(x => x.expenseDate))].sort();
    const startDate = this.trip?.startDate;

    const getDayLabel = (dateStr, idx) => {
      if (startDate && dateStr >= startDate) {
        const diff = Math.floor((new Date(dateStr) - new Date(startDate)) / 86400000) + 1;
        return `Day ${diff} (${dateStr})`;
      }
      return `Day ${idx + 1} (${dateStr})`;
    };

    // 計算每日每位成員的分攤
    const dailyRows = allDates.map((d, idx) => {
      const dayExpenses = es.filter(e => e.expenseDate === d);
      const dayCurrencies = [...new Set(dayExpenses.map(e => e.currency))];

      const memberCells = ms.map(m => {
        const sharesPerCur = dayCurrencies.map(c => {
          const sum = dayExpenses
            .filter(e => e.currency === c)
            .reduce((total, e) => {
              const s = e.shares.find(x => x.memberId === m.id);
              return total + (s?.finalShareMinor || 0);
            }, 0);
          return sum > 0 ? this.fmt(sum, c) : null;
        }).filter(Boolean);

        return `<td>${sharesPerCur.join('<br>') || '-'}</td>`;
      }).join('');

      const dayTotalStrings = dayCurrencies.map(c => {
        const sum = dayExpenses
          .filter(e => e.currency === c)
          .reduce((total, e) => total + e.finalAmountMinor, 0);
        return this.fmt(sum, c);
      });

      return `
        <tr>
          <td><b>${getDayLabel(d, idx)}</b></td>
          ${memberCells}
          <td><b>${dayTotalStrings.join('<br>')}</b></td>
        </tr>
      `;
    }).join('');

    // 成員總計行
    const totalRow = `
      <tfoot>
        <tr>
          <td><b>累計總計</b></td>
          ${ms.map(m => {
            const memberTotals = currencies.map(c => {
              const sum = es
                .filter(e => e.currency === c)
                .reduce((total, e) => {
                  const s = e.shares.find(x => x.memberId === m.id);
                  return total + (s?.finalShareMinor || 0);
                }, 0);
              return sum > 0 ? this.fmt(sum, c) : null;
            }).filter(Boolean);
            return `<td><b>${memberTotals.join('<br>') || '-'}</b></td>`;
          }).join('')}
          <td>
            <b>${currencies.map(c => {
              const sum = es.filter(e => e.currency === c).reduce((t, e) => t + e.finalAmountMinor, 0);
              return sum > 0 ? this.fmt(sum, c) : null;
            }).filter(Boolean).join('<br>') || '-'}</b>
          </td>
        </tr>
      </tfoot>
    `;

    // 5. 成員快速切換入口
    const memberEntryCards = `
      <div class="card" style="margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h2 style="margin:0">👤 成員個人消費明細</h2>
          <small class="muted">點擊成員查看個人帳目明細與代墊統計</small>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${ms.map(m => `
            <button class="primary btn-sm" data-action="openMemberDetail" data-id="${m.id}">
              ${this.esc(m.name)} 的消費明細 ➔
            </button>
          `).join('') || '<p class="muted">尚未有成員。</p>'}
        </div>
      </div>
    `;

    this.show(`
      ${memberEntryCards}

      <div class="card" style="margin-bottom:18px">
        <h2>📅 每日每位成員消費總額</h2>
        <p class="muted" style="font-size:12px;margin:-4px 0 10px">依日期 (Day 1 ~ Day N) 展開，檢視每位成員每天實際被分攤到的支出金額。</p>
        <div class="daily-table-wrap">
          <table class="daily-table">
            <thead>
              <tr>
                <th>日期 (天數)</th>
                ${ms.map(m => `<th><a href="#" data-action="openMemberDetail" data-id="${m.id}" style="color:inherit;text-decoration:underline">${this.esc(m.name)}</a></th>`).join('')}
                <th>當日全額</th>
              </tr>
            </thead>
            <tbody>
              ${dailyRows || '<tr><td colspan="' + (ms.length + 2) + '" class="muted" style="text-align:center">尚未有任何帳目。</td></tr>'}
            </tbody>
            ${allDates.length ? totalRow : ''}
          </table>
        </div>
      </div>

      ${currencyCards}
    `);
  },

  // 5. 新增「成員消費詳細頁」（獨立頁面，支援切換與按日期展開）
  memberDetail(memberId) {
    const ms = this.items('members');
    if (!ms.length) {
      this.head('成員明細', '尚無成員');
      this.show('<div class="empty">請先新增成員</div>');
      return;
    }

    const currentMember = ms.find(x => x.id === memberId) || ms[0];
    this.currentMemberId = currentMember.id;
    this.head(`${currentMember.name} 的消費明細`, '檢視該成員參與的每一筆消費、分攤與代墊情況');

    const es = this.items('expenses');
    const currencies = [...new Set(es.map(x => x.currency))];
    if (this.trip && !currencies.includes(this.trip.defaultCurrency)) {
      currencies.unshift(this.trip.defaultCurrency);
    }

    // 該成員在各幣別的總分攤、總代墊、淨額
    const statsPerCur = currencies.map(c => {
      let shared = 0;
      let paid = 0;
      let settled = 0;

      es.filter(e => e.currency === c).forEach(e => {
        const s = e.shares.find(x => x.memberId === currentMember.id);
        if (s) shared += s.finalShareMinor;
        const p = e.payers.find(x => x.memberId === currentMember.id);
        if (p) paid += p.amountMinor;
      });

      this.items('settlements').filter(x => x.currency === c).forEach(st => {
        if (st.fromMemberId === currentMember.id) settled += st.amountMinor;
        if (st.toMemberId === currentMember.id) settled -= st.amountMinor;
      });

      const net = paid - shared + settled;
      return { currency: c, shared, paid, settled, net };
    }).filter(x => x.shared > 0 || x.paid > 0 || x.settled !== 0);

    // 篩選與該成員相關的所有消費（參與分攤或參與付款）
    const memberExpenses = es
      .filter(e => e.shares.some(s => s.memberId === currentMember.id) || e.payers.some(p => p.memberId === currentMember.id))
      .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));

    // 按日期分組
    const groupedByDate = {};
    memberExpenses.forEach(e => {
      if (!groupedByDate[e.expenseDate]) groupedByDate[e.expenseDate] = [];
      groupedByDate[e.expenseDate].push(e);
    });

    const dates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

    const memberTabs = `
      <div class="member-tabs">
        ${ms.map(m => `
          <button class="${m.id === currentMember.id ? 'active' : ''}" data-action="openMemberDetail" data-id="${m.id}">
            ${this.esc(m.name)}${m.isActive ? '' : ' (停用)'}
          </button>
        `).join('')}
      </div>
    `;

    const summaryCards = `
      <div class="cards" style="margin-bottom:18px">
        <div class="card metric">
          <small>個人實際總分攤</small>
          <strong style="font-size:18px">
            ${statsPerCur.map(x => this.fmt(x.shared, x.currency)).join(' + ') || this.fmt(0, this.trip?.defaultCurrency)}
          </strong>
        </div>
        <div class="card metric">
          <small>代墊付款總計</small>
          <strong style="font-size:18px">
            ${statsPerCur.map(x => this.fmt(x.paid, x.currency)).join(' + ') || this.fmt(0, this.trip?.defaultCurrency)}
          </strong>
        </div>
        <div class="card metric">
          <small>目前淨額狀態</small>
          <strong style="font-size:18px">
            ${statsPerCur.map(x => `<span class="${x.net >= 0 ? 'positive' : 'negative'}">${this.fmt(x.net, x.currency)}</span>`).join(' + ') || this.fmt(0, this.trip?.defaultCurrency)}
          </strong>
        </div>
        <div class="card metric">
          <small>參與帳目筆數</small>
          <strong>${memberExpenses.length}</strong>
        </div>
      </div>
    `;

    const splitMethodNames = {
      EQUAL: '均分',
      EXACT: '精確金額',
      SHARES: '份數',
      PERCENTAGE: '百分比'
    };

    const dateSections = dates.map(d => {
      const items = groupedByDate[d];
      const dayCurrencies = [...new Set(items.map(x => x.currency))];

      const dayShareStrings = dayCurrencies.map(c => {
        const sum = items
          .filter(e => e.currency === c)
          .reduce((total, e) => {
            const s = e.shares.find(x => x.memberId === currentMember.id);
            return total + (s?.finalShareMinor || 0);
          }, 0);
        return sum > 0 ? this.fmt(sum, c) : null;
      }).filter(Boolean);
      const dayShareTotalStr = dayShareStrings.length ? dayShareStrings.join(' + ') : this.fmt(0, this.trip?.defaultCurrency);

      const dayPaidStrings = dayCurrencies.map(c => {
        const sum = items
          .filter(e => e.currency === c)
          .reduce((total, e) => {
            const p = e.payers.find(x => x.memberId === currentMember.id);
            return total + (p?.amountMinor || 0);
          }, 0);
        return sum > 0 ? this.fmt(sum, c) : null;
      }).filter(Boolean);
      const dayPaidTotalStr = dayPaidStrings.length ? dayPaidStrings.join(' + ') : null;

      return `
        <div class="card" style="margin-bottom:14px">
          <div class="date-header">
            <div>
              <span>📅 ${d}</span>
              <span class="muted" style="font-weight:normal;font-size:12px;margin-left:6px">${items.length} 筆帳目</span>
            </div>
            <div style="text-align:right">
              <span style="font-size:12px;font-weight:normal;color:var(--muted)">當日個人應攤：</span>
              <b style="color:var(--p);font-size:15px">${dayShareTotalStr}</b>
            </div>
          </div>
          ${items.map(e => {
            const personalShare = e.shares.find(s => s.memberId === currentMember.id);
            const personalPaid = e.payers.find(p => p.memberId === currentMember.id);
            return `
              <div class="row" style="padding:10px 0">
                <div>
                  <b>${this.esc(e.name)}</b>
                  <div class="muted" style="font-size:12px">
                    ${e.category} · ${splitMethodNames[e.splitMethod] || e.splitMethod}
                    ${personalPaid ? `<span class="pill positive" style="margin-left:6px">代墊 ${this.fmt(personalPaid.amountMinor, e.currency)}</span>` : '<span class="pill muted" style="margin-left:6px">他人代付</span>'}
                  </div>
                </div>
                <div style="text-align:right">
                  <div>個人應攤：<b style="color:var(--p)">${personalShare ? this.fmt(personalShare.finalShareMinor, e.currency) : '-'}</b></div>
                  <small class="muted">帳目全額：${this.fmt(e.finalAmountMinor, e.currency)}</small>
                </div>
              </div>
            `;
          }).join('')}
          <div style="border-top:1px dashed var(--line);margin-top:8px;padding-top:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;font-size:13px">
            <span class="muted"><b>${d} 當日小計</b></span>
            <div style="text-align:right">
              <span>個人應攤總額：<b style="color:var(--p);font-size:14px">${dayShareTotalStr}</b></span>
              ${dayPaidTotalStr ? `<span style="margin-left:12px;color:var(--success)">代墊付款：<b>${dayPaidTotalStr}</b></span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    this.show(`
      <div class="toolbar" style="margin-bottom:12px">
        <button class="btn-sm" data-action="go" data-p="analytics">← 返回統計分析</button>
      </div>
      ${memberTabs}
      ${summaryCards}
      <h3 style="margin:20px 0 10px">按日期消費紀錄</h3>
      ${dateSections || '<div class="empty">此成員尚無任何參與的帳目記錄。</div>'}
    `);
  },

  settings() {
    this.head('設定與備份', '定期匯出備份，避免瀏覽器資料被清除');
    this.show(`
      <div class="card">
        <div class="row">
          <div>
            <b>匯出完整 JSON</b>
            <div class="muted">備份所有行程、帳目、成員與設定資料。</div>
          </div>
          <button class="primary btn-sm" data-action="exportData">匯出備份</button>
        </div>
        <div class="row">
          <div>
            <b>匯入完整 JSON</b>
            <div class="muted">匯入前會要求確認，將完全還原資料庫。</div>
          </div>
          <label>
            <input id="importFile" hidden type="file" accept=".json">
            <button class="btn-sm" data-action="importClick">匯入檔案</button>
          </label>
        </div>
        <div class="row">
          <b>版本</b>
          <span>2.0.0</span>
        </div>
        <div class="row">
          <b>目前行程</b>
          <button class="btn-sm" data-action="go" data-p="trips">行程管理</button>
        </div>
      </div>
    `);
  },

  async exportData() {
    const data = {};
    for (const s of DB.stores) {
      data[s] = await DB.all(s);
      if (s === 'attachments') {
        for (const a of data[s]) {
          if (a.blob) {
            a.base64 = await new Promise(ok => {
              const r = new FileReader();
              r.onload = () => ok(r.result);
              r.readAsDataURL(a.blob);
            });
          }
        }
      }
    }
    const blob = new Blob([JSON.stringify({
      application: { id: 'tripsplit-lite', version: '2.0.0' },
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      data
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `TripSplit-Lite-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  async importData(file) {
    if (!file || !confirm('匯入會取代現有資料庫中的所有資料，是否確定繼續？')) return;
    try {
      const p = JSON.parse(await file.text());
      if (p?.application?.id !== 'tripsplit-lite') throw Error('不是有效的 TripSplit Lite 備份檔案');
      for (const s of DB.stores) await DB.clear(s);
      for (const s of DB.stores) {
        for (const x of (p.data[s] || [])) {
          if (s === 'attachments' && x.base64) {
            x.blob = await fetch(x.base64).then(r => r.blob());
            delete x.base64;
          }
          // 向下相容歷史版本備份欄位
          if (s === 'expenses') {
            if (!x.adjustmentMode) x.adjustmentMode = 'AMOUNT';
            if (x.adjustmentValue === undefined) {
              x.adjustmentValue = Money.toMajor(x.adjustmentAmountMinor || 0, x.currency);
            }
          }
          await DB.put(s, x);
        }
      }
      this.trip = null;
      await this.reload();
      this.trip = this.data.trips.find(x => x.status !== 'archived') || null;
      if (this.trip && this.trip.isShared && window.Cloud) {
        Cloud.subscribe(this.trip.id);
      } else if (window.Cloud) {
        Cloud.unsubscribe();
        Cloud.updateUI();
      }
      this.go(this.trip ? 'dashboard' : 'trips');
      this.msg('備份資料已成功匯入（相容所有歷史版本）');
    } catch (e) {
      this.msg(e.message, 'error');
    }
  }
};

App.init();
