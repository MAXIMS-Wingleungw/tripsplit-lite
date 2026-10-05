const Money = {
  digits: c => ['JPY', 'TWD', 'KRW'].includes(c) ? 0 : 2,
  toMinor: (v, c) => Math.round(Number(v || 0) * 10 ** Money.digits(c)),
  toMajor: (v, c) => (v || 0) / 10 ** Money.digits(c),
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
    const adj = Money.allocate(Math.abs(e.adjustmentAmountMinor || 0), base);
    return inputs.map((x, i) => ({
      memberId: x.memberId,
      baseShareMinor: base[i],
      adjustmentShareMinor: e.adjustmentType === 'REFUND' ? -adj[i] : adj[i],
      finalShareMinor: base[i] + (e.adjustmentType === 'REFUND' ? -adj[i] : adj[i])
    }));
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
  }
};
