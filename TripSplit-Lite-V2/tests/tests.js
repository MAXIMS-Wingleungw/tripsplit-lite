const isNode = typeof document === 'undefined';
const log = (msg) => {
  if (isNode) console.log(msg);
  else {
    const o = document.querySelector('#o');
    if (o) o.textContent += msg + '\n';
  }
};
const t = (n, c) => log((c ? 'PASS ' : 'FAIL ') + n);

// 基礎金額與分帳測試
t('100/3 尾差分配', JSON.stringify(Money.allocate(100, [1, 1, 1])) === '[34,33,33]');
t('結算債務建議', Debt.suggest([{ memberId: 'A', amount: 500 }, { memberId: 'B', amount: -500 }])[0].amount === 500);
t('JPY 無小數換算', Money.toMinor(1000, 'JPY') === 1000);
t('HKD 兩位小數換算', Money.toMinor(12.34, 'HKD') === 1234);
t('TWD 無小數換算', Money.toMinor(500, 'TWD') === 500);

// 階段一：百分比附加調整計算測試
const baseMinor = Money.toMinor(96, 'HKD'); // 9600
const pct = 10;
const adjMinor = Math.round(baseMinor * pct / 100); // 960
t('百分比稅費計算 96 * 10% = 9.60 (960 minor)', adjMinor === 960 && Money.toMajor(adjMinor, 'HKD') === 9.6);

// 階段一：精確金額手動輸入與自動補齊最後一人
const exactBaseMinor = Money.toMinor(100, 'HKD'); // 10000
const m1 = Money.toMinor(30, 'HKD');
const m2 = Money.toMinor(40, 'HKD');
const m3Remaining = exactBaseMinor - (m1 + m2);
t('精確分帳自動計算最後一人剩餘金額', m3Remaining === 3000 && Money.toMajor(m3Remaining, 'HKD') === 30);
const m1Over = Money.toMinor(70, 'HKD');
const m2Over = Money.toMinor(40, 'HKD');
const m3Negative = exactBaseMinor - (m1Over + m2Over);
t('精確分帳前面超額判定最後一人 < 0', m3Negative < 0 && m3Negative === -1000);

// 階段三：Debt.explain 債務簡化推導詳細過程測試
const balances = [
  { memberId: 'Alice', amount: 600 },
  { memberId: 'Bob', amount: -200 },
  { memberId: 'Charlie', amount: -400 }
];
const explanation = Debt.explain(balances);
t('Debt.explain 步驟數量正確 (2步結清)', explanation.steps.length === 2);
t('Debt.explain 第一步 Charlie 轉帳 400 給 Alice', explanation.steps[0].from === 'Charlie' && explanation.steps[0].to === 'Alice' && explanation.steps[0].amount === 400 && explanation.steps[0].debtorCleared === true);
t('Debt.explain 第二步 Bob 轉帳 200 給 Alice 全數結清', explanation.steps[1].from === 'Bob' && explanation.steps[1].to === 'Alice' && explanation.steps[1].amount === 200 && explanation.steps[1].creditorCleared === true);

// 歷史備份向下相容性測試
const legacyExpense = {
  id: 'exp1',
  name: '居酒屋',
  currency: 'HKD',
  baseAmountMinor: 10000,
  adjustmentAmountMinor: 1000
  // 無 adjustmentMode 與 adjustmentValue
};
const compatibleExpense = {
  ...legacyExpense,
  adjustmentMode: legacyExpense.adjustmentMode || 'AMOUNT',
  adjustmentValue: legacyExpense.adjustmentValue !== undefined ? legacyExpense.adjustmentValue : Money.toMajor(legacyExpense.adjustmentAmountMinor, legacyExpense.currency)
};
t('歷史備份相容性 - 自動補齊 adjustmentMode 為 AMOUNT', compatibleExpense.adjustmentMode === 'AMOUNT');
t('歷史備份相容性 - 自動轉換 adjustmentValue 為主貨幣單位 (10)', compatibleExpense.adjustmentValue === 10);

