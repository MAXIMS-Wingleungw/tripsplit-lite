const App = {
  trip: null,
  page: 'trips',
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
      this.trip = this.data.trips.find(x => x.status !== 'archived') || null;
      this.go(this.trip ? 'dashboard' : 'trips');
    } catch (e) {
      const b = document.querySelector('#boot');
      if (b) b.textContent = '無法開啟本機資料庫：' + e.message;
    }
  },

  async reload() {
    for (const s of DB.stores) this.data[s] = await DB.all(s);
  },

  bind() {
    const quickAdd = document.getElementById('quickAdd');
    const modal = document.getElementById('modal');
    const modalForm = document.getElementById('modalForm');
    const tripBadge = document.getElementById('tripBadge');
    const view = document.getElementById('view');

    if (quickAdd) quickAdd.onclick = () => this.expenseModal();
    if (tripBadge) {
      tripBadge.onclick = () => this.go('trips');
      tripBadge.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') this.go('trips'); };
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
      if (act === 'go') return this.go(btn.dataset.p);
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
      `<button data-p="${x[0]}" class="${this.page === x[0] ? 'active' : ''}">${x[1]}</button>`
    ).join('');

    // 修正一：手機底部導覽 [總覽, 帳目, 結算, 行程, 更多]
    const isMoreActive = ['more', 'members', 'analytics', 'rates', 'settings'].includes(this.page);
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

  go(p) {
    if (!this.trip && !['trips', 'settings', 'more'].includes(p)) p = 'trips';
    this.page = p;
    this.nav();
    const tripBadge = document.getElementById('tripBadge');
    const quickAdd = document.getElementById('quickAdd');
    tripBadge.textContent = this.trip ? `${this.trip.name} · ${this.trip.defaultCurrency}` : '尚未選擇行程 (點擊切換)';
    quickAdd.hidden = !this.trip || ['trips', 'settings', 'more'].includes(p);

    const routes = {
      trips: () => this.trips(),
      dashboard: () => this.dashboard(),
      expenses: () => this.expenses(),
      members: () => this.members(),
      rates: () => this.rates(),
      settlements: () => this.settlements(),
      analytics: () => this.analytics(),
      settings: () => this.settings(),
      more: () => this.more()
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
  },

  // 修正一：手機「更多」入口頁面（含成員、統計、匯率、行程、設定）
  more() {
    this.head('更多功能', '管理成員、統計分析、匯率、行程切換與資料備份');
    this.show(`
      <div class="menu-grid">
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
            <small>按分類查看消費統計與各類別支出圖表</small>
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
    this.head('我的行程', '可隨時切換或建立新行程');
    const rows = (this.data.trips || []).map(t => `
      <div class="row">
        <div>
          <b>${this.esc(t.name)}</b>
          <div class="muted">${t.startDate || '未設定日期'} · ${t.defaultCurrency}</div>
        </div>
        <div>
          <button class="primary btn-sm" data-action="openTrip" data-id="${t.id}">開啟</button>
          <button class="danger btn-sm" data-action="deleteTrip" data-id="${t.id}">刪除</button>
        </div>
      </div>
    `).join('');

    this.show(`
      <div class="toolbar">
        <button class="primary" data-action="tripModal">＋ 建立行程</button>
      </div>
      ${rows ? `<div class="card">${rows}</div>` : `
        <div class="empty">
          <h2>尚未建立行程</h2>
          <p>建立第一個行程以開始記錄分帳。</p>
          <button class="primary" data-action="tripModal">建立行程</button>
        </div>
      `}
    `);
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
        createdAt: n,
        updatedAt: n
      };
      await DB.put('trips', o);
      this.trip = o;
      this.page = 'dashboard';
    });
  },

  async openTrip(id) {
    this.trip = this.data.trips.find(x => x.id === id);
    this.go('dashboard');
  },

  async deleteTrip(id) {
    if (!confirm('確定刪除此行程及其所有相關帳目與成員資料？')) return;
    for (const s of DB.stores) {
      for (const x of (this.data[s] || [])) {
        if (x.tripId === id) await DB.del(s, x.id);
      }
    }
    await DB.del('trips', id);
    if (this.trip?.id === id) {
      await this.reload();
      this.trip = this.data.trips.find(x => x.status !== 'archived') || null;
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
            <button class="btn-sm" data-action="toggleMember" data-id="${m.id}">${m.isActive ? '停用' : '啟用'}</button>
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
      await DB.put('members', {
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
    await DB.put('members', m);
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
        <div class="field">
          <label>附加調整</label>
          <select id="fAdjType">
            ${[['NONE', '無'], ['ADDITIVE_TAX', '外加稅／服務費 (+)'], ['REFUND', '退稅 (-)']].map(x => `
              <option value="${x[0]}" ${old?.adjustmentType === x[0] ? 'selected' : ''}>${x[1]}</option>
            `).join('')}
          </select>
        </div>
        <div class="field">
          <label>調整金額</label>
          <input id="fAdj" type="number" min="0" step="${Money.digits(cur) === 0 ? '1' : '0.01'}" value="${old ? Money.toMajor(old.adjustmentAmountMinor, cur) : 0}">
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

        <!-- 分攤成員與比例 -->
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
                  <input class="shareValue" data-id="${m.id}" type="number" min="0" step="0.01" value="${old?.splitMethod === 'EXACT' && s ? Money.toMajor(s.baseShareMinor, cur) : s?.inputValue || 1}">
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

      const currency = fCurrency.value;
      const base = Money.toMinor(fAmount.value, currency);
      const adj = Money.toMinor(fAdj.value || 0, currency);
      const type = fAdjType.value;
      const final = base + (type === 'ADDITIVE_TAX' ? adj : type === 'REFUND' ? -adj : 0);

      if (!fName.value.trim()) throw Error('請輸入帳目名稱');
      if (!fDate.value) throw Error('請選擇日期');
      if (base <= 0) throw Error('基礎金額必須大於零');
      if (final < 0) throw Error('最終金額不可小於零');

      const inputs = [...document.querySelectorAll('.shareCheck:checked')].map(x => ({
        memberId: x.value,
        value: fSplit.value === 'EXACT'
          ? Money.toMinor(document.querySelector(`.shareValue[data-id="${x.value}"]`).value, currency)
          : Number(document.querySelector(`.shareValue[data-id="${x.value}"]`).value)
      }));
      if (!inputs.length) throw Error('請至少選擇一位分攤成員');

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

      await DB.put('expenses', e);
    });

    // 綁定 Modal 內部即時計算與自動平衡
    this.bindExpenseModalInteractions(cur, !old);
  },

  bindExpenseModalInteractions(initialCur, isNew) {
    const fCurrency = document.getElementById('fCurrency');
    const fAmount = document.getElementById('fAmount');
    const fAdjType = document.getElementById('fAdjType');
    const fAdj = document.getElementById('fAdj');
    const fSplit = document.getElementById('fSplit');
    const btnPayerAuto = document.getElementById('btnPayerAuto');
    const btnPayerRemain = document.getElementById('btnPayerRemain');
    const btnShareSplit = document.getElementById('btnShareSplit');
    const payerStatus = document.getElementById('payerStatus');
    const shareStatus = document.getElementById('shareStatus');

    const getFinalAmountMinor = () => {
      const cur = fCurrency.value;
      const base = Money.toMinor(fAmount.value || 0, cur);
      const adj = Money.toMinor(fAdj.value || 0, cur);
      const type = fAdjType.value;
      return Math.max(0, base + (type === 'ADDITIVE_TAX' ? adj : type === 'REFUND' ? -adj : 0));
    };

    const updateCalculations = (changedSource) => {
      const cur = fCurrency.value;
      const finalMinor = getFinalAmountMinor();
      const baseMinor = Money.toMinor(fAmount.value || 0, cur);
      const checkedPayers = [...document.querySelectorAll('.payerCheck:checked')];

      // 修正三：若僅有一位付款人被勾選，金額自動追隨最終金額填入
      if (['amount', 'currency', 'adj'].includes(changedSource) && checkedPayers.length === 1) {
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
            if (diffExact === 0 && baseMinor > 0) {
              shareStatus.className = 'balance-status balanced';
              shareStatus.innerHTML = `<span>精確分攤總計：<b>${this.fmt(sumExactMinor, cur)}</b></span> <span>平衡 ✓</span>`;
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

    // 填入剩餘按鈕
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
      fAdj.step = step;
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
    document.querySelectorAll('.shareValue').forEach(inp => {
      inp.oninput = () => updateCalculations('shareManual');
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
    await DB.del('expenses', id);
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
      await DB.put('exchangeRates', {
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
    await DB.del('exchangeRates', id);
    await this.reload();
    this.go('rates');
    this.msg('匯率已刪除');
  },

  // 結算方案（含建議結算與一鍵記錄還款）
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
            <h2>${c} 成員餘額</h2>
            ${b.map(x => `
              <div class="row">
                <b>${this.esc(x.name)}</b>
                <strong class="${x.amount >= 0 ? 'positive' : 'negative'}">${this.fmt(x.amount, c)}</strong>
              </div>
            `).join('') || '<p class="muted">無餘額數據。</p>'}
          </div>
          <div class="card settle">
            <h2>${c} 建議轉帳</h2>
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
    await DB.put('settlements', {
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
    await DB.del('settlements', id);
    await this.reload();
    this.go('settlements');
    this.msg('還款記錄已撤銷');
  },

  analytics() {
    this.head('統計分析', '按分類顯示預設貨幣支出');
    const by = {};
    this.items('expenses').filter(e => e.currency === this.trip.defaultCurrency).forEach(e => {
      by[e.category] = (by[e.category] || 0) + e.finalAmountMinor;
    });
    const max = Math.max(1, ...Object.values(by));
    this.show(`
      <div class="card">
        <h2>分類消費（${this.trip.defaultCurrency}）</h2>
        <div class="chart">
          ${Object.entries(by).map(([k, v]) => `
            <div class="bar" style="height:${Math.max(8, v / max * 100)}%">
              <span>${k}<br>${this.fmt(v, this.trip.defaultCurrency)}</span>
            </div>
          `).join('') || '<p class="muted">尚未有預設貨幣的帳目資料。</p>'}
        </div>
      </div>
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
          <span>1.2</span>
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
      application: { id: 'tripsplit-lite', version: '1.2' },
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
          await DB.put(s, x);
        }
      }
      this.trip = null;
      await this.reload();
      this.trip = this.data.trips.find(x => x.status !== 'archived') || null;
      this.go(this.trip ? 'dashboard' : 'trips');
      this.msg('備份資料已成功匯入');
    } catch (e) {
      this.msg(e.message, 'error');
    }
  }
};

App.init();
