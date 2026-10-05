const o = document.querySelector('#o');
const t = (n, c) => o.textContent += (c ? 'PASS ' : 'FAIL ') + n + '\n';

t('100/3 尾差分配', JSON.stringify(Money.allocate(100, [1, 1, 1])) === '[34,33,33]');
t('結算債務建議', Debt.suggest([{ memberId: 'A', amount: 500 }, { memberId: 'B', amount: -500 }])[0].amount === 500);
t('JPY 無小數換算', Money.toMinor(1000, 'JPY') === 1000);
t('HKD 兩位小數換算', Money.toMinor(12.34, 'HKD') === 1234);
t('TWD 無小數換算', Money.toMinor(500, 'TWD') === 500);
