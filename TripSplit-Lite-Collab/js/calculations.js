const Money = {
  digits: c => ['JPY', 'TWD', 'KRW'].includes(c) ? 0 : 2,
  toMinor: (v, c) => Math.round(Number(v || 0) * 10 ** Money.digits(c)),
  toMajor: (v, c) => (v || 0) / 10 ** Money.digits(c),
  adjustment(e) {
    if (e.adjustmentType === 'REFUND') {
      if (e.refundReceived !== true) return 0;
      const actual = e.refundReceivedAmountMinor;
      if (!Number.isSafeInteger(actual) || actual < 0 || actual > e.baseAmountMinor) {
        throw Error('實收退稅金額必須介乎零與基礎金額之間');
      }
      return actual;
    }
    return e.adjustmentType === 'ADDITIVE_TAX' ? Math.abs(e.adjustmentAmountMinor || 0) : 0;
  },
  finalAmount(e) {
    const adjustment = Money.adjustment(e);
    return e.baseAmountMinor + (e.adjustmentType === 'REFUND' ? -adjustment : adjustment);
  },
  normalizeRefund(e) {
    if (e.adjustmentType !== 'REFUND') return e;
    const normalized = {
      ...e,
      refundReceived: e.refundReceived === true,
      refundReceivedAmountMinor: e.refundReceived === true ? e.refundReceivedAmountMinor : 0
    };
    if (e.refundReceived === undefined) normalized.refundLegacyPending = true;
    normalized.finalAmountMinor = Money.finalAmount(normalized);
    if (e.shares?.length) {
      const amounts = Money.allocate(Money.adjustment(normalized), e.shares.map(s => s.baseShareMinor));
      normalized.shares = e.shares.map((s, i) => ({
        ...s,
        adjustmentShareMinor: -amounts[i],
        finalShareMinor: s.baseShareMinor - amounts[i]
      }));
    }
    // 舊版付款人儲存的是扣除預計退稅後的淨額；恢復待收時按原付款比例還原。
    if (e.payers?.length && e.payers.reduce((sum, p) => sum + p.amountMinor, 0) !== normalized.finalAmountMinor) {
      const weights = e.payers.map(p => p.amountMinor);
      const amounts = Money.allocate(normalized.finalAmountMinor, weights.some(w => w > 0) ? weights : weights.map(() => 1));
      normalized.payers = e.payers.map((p, i) => ({ ...p, amountMinor: amounts[i] }));
    }
    return normalized;
  },
  allocate(total, weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0) throw Error('分攤值必須大於零');
    const raw = weights.map(w => total * w / sum),
          out = raw.map(Math.floor);
    let left = total - out.reduce((a, b) => a + b, 0);
    raw.map((x, i) => ({ i, r: x - out[i] })).sort((a, b) => b.r - a.r || a.i - b.i).slice(0, left).forEach(x => out[x.i]++);
    return out;
  },
  shares(e, inputs) {
    let base;
    if (e.splitMethod === 'EQUAL') {
      base = Money.allocate(e.baseAmountMinor, inputs.map(() => 1));
    } else if (e.splitMethod === 'EXACT') {
      base = inputs.map(x => Number(x.value));
      if (base.reduce((a, b) => a + b, 0) !== e.baseAmountMinor) throw Error('精確分攤總和必須等於基礎金額');
    } else {
      if (e.splitMethod === 'PERCENTAGE' && Math.abs(inputs.reduce((a, b) => a + Number(b.value), 0) - 100) > .0001) {
        throw Error('百分比總和必須等於 100%');
      }
      base = Money.allocate(e.baseAmountMinor, inputs.map(x => Number(x.value)));
    }
    const adjAmount = Money.adjustment(e);
    const adj = Money.allocate(adjAmount, base);
    return inputs.map((x, i) => {
      const adjShare = e.adjustmentType === 'REFUND' ? -adj[i] : (e.adjustmentType === 'ADDITIVE_TAX' ? adj[i] : 0);
      return {
        memberId: x.memberId,
        baseShareMinor: base[i],
        adjustmentShareMinor: adjShare,
        finalShareMinor: base[i] + adjShare
      };
    });
  }
};

const Debt = {
  suggest(b) {
    let c = b.filter(x => x.amount > 0).map(x => ({ ...x })).sort((a, b) => b.amount - a.amount),
        d = b.filter(x => x.amount < 0).map(x => ({ ...x, amount: -x.amount })).sort((a, b) => b.amount - a.amount),
        o = [],
        i = 0,
        j = 0;
    while (i < d.length && j < c.length) {
      const n = Math.min(d[i].amount, c[j].amount);
      if (n) o.push({ from: d[i].memberId, to: c[j].memberId, amount: n });
      d[i].amount -= n;
      c[j].amount -= n;
      if (!d[i].amount) i++;
      if (!c[j].amount) j++;
    }
    return o;
  },

  explain(b) {
    const creditors = b.filter(x => x.amount > 0).map(x => ({ ...x })).sort((a, b) => b.amount - a.amount);
    const debtors = b.filter(x => x.amount < 0).map(x => ({ ...x, amount: -x.amount })).sort((a, b) => b.amount - a.amount);
    const steps = [];
    const transfers = [];
    let i = 0, j = 0, step = 1;

    const workingDebtors = debtors.map(x => ({ ...x }));
    const workingCreditors = creditors.map(x => ({ ...x }));

    while (i < workingDebtors.length && j < workingCreditors.length) {
      const n = Math.min(workingDebtors[i].amount, workingCreditors[j].amount);
      if (n > 0) {
        const debtorOwedBefore = workingDebtors[i].amount;
        const creditorEntitledBefore = workingCreditors[j].amount;
        const debtorRemaining = debtorOwedBefore - n;
        const creditorRemaining = creditorEntitledBefore - n;

        transfers.push({ from: workingDebtors[i].memberId, to: workingCreditors[j].memberId, amount: n });
        steps.push({
          step: step++,
          from: workingDebtors[i].memberId,
          to: workingCreditors[j].memberId,
          amount: n,
          debtorOwedBefore,
          creditorEntitledBefore,
          debtorRemaining,
          creditorRemaining,
          debtorCleared: debtorRemaining === 0,
          creditorCleared: creditorRemaining === 0
        });

        workingDebtors[i].amount -= n;
        workingCreditors[j].amount -= n;
      }
      if (!workingDebtors[i].amount) i++;
      if (!workingCreditors[j].amount) j++;
    }

    return {
      creditors: creditors.map(x => ({ memberId: x.memberId, amount: x.amount })),
      debtors: debtors.map(x => ({ memberId: x.memberId, amount: x.amount })),
      transfers,
      steps
    };
  }
};
