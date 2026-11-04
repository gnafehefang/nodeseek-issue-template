'use strict';
// 从 src 中按函数名抽出纯计算函数，在 vm 里执行，避免依赖 DOM / Tampermonkey。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
function extract(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  const end = source.indexOf('\n  }\n', start);
  return source.slice(start, end + 4);
}
const config = src('config.js');
const logic = src('logic.js');
const cycleLine = config.match(/ {2}const CYCLE_MONTHS = .*;\n/)[0];
const code = [cycleLine, ...['parseDate', 'differenceInDays', 'addMonths', 'calculation', 'cycleShareText', 'cycleShareLabel', 'cycleFormulaText'].map((n) => extract(logic, n))].join('\n');
const ctx = {};
vm.runInNewContext(`${code}\nthis.api = { calculation, cycleShareText, cycleShareLabel, cycleFormulaText };`, ctx);
const { calculation, cycleShareText, cycleShareLabel, cycleFormulaText } = ctx.api;
const calc = (renewalCycle, renewalAmount, expiryDate, tradeDate) => calculation({ renewalCycle, renewalAmount, expiryDate, tradeDate });
const round2 = (n) => Math.round(n * 100) / 100;

test('monthly with several cycles left (user case)', () => {
  const r = calc('月付', '17.18', '2027-03-01', '2026-11-03');
  assert.strictEqual(r.daysLeft, 118);
  assert.strictEqual(r.wholeCycles, 3);
  assert.strictEqual(r.partialDays, 28);
  assert.strictEqual(r.cycleDays, 30);
  assert.strictEqual(round2(r.value), 67.57);
  assert.strictEqual(round2(r.value * 7.4532), 503.65);
  assert.strictEqual(cycleShareText(r), '3.93 个周期');
  assert.strictEqual(cycleShareLabel(r), '剩余 3.93 个周期');
  assert.strictEqual(cycleFormulaText(r, '€', '17.18'), '€17.18 × (3 + 28/30) 个周期');
});

test('less than one cycle keeps day ratio and percentage', () => {
  const r = calc('月付', '10', '2027-03-01', '2027-02-15');
  assert.strictEqual(r.daysLeft, 14);
  assert.strictEqual(r.cycleDays, 28);
  assert.strictEqual(round2(r.value), 5);
  assert.strictEqual(cycleShareText(r), '50.0%');
  assert.strictEqual(cycleShareLabel(r), '周期占比 50.0%');
  assert.strictEqual(cycleFormulaText(r, '$', '10'), '$10 × 14 天 ÷ 28 天');
});

test('yearly cycle, partial year prorated by that year length', () => {
  const r = calc('年付', '36.5', '2027-06-01', '2026-11-03');
  assert.strictEqual(r.wholeCycles, 0);
  assert.strictEqual(r.cycleDays, 365);
  assert.strictEqual(r.daysLeft, 210);
  assert.strictEqual(round2(r.value), 21);
  const multi = calc('年付', '100', '2028-06-01', '2026-11-03');
  assert.strictEqual(multi.wholeCycles, 1);
  assert.strictEqual(round2(multi.value), round2(100 * (1 + 210 / 365)));
});

test('end-of-month expiry anchors every step on the expiry date', () => {
  const r = calc('月付', '31', '2027-03-31', '2026-12-15');
  // 3/31 → 2/28 → 1/31 → 12/31 都 >= 12/15，共 3 个整周期；残缺段 12/15→12/31 落在 11/30→12/31（31 天）。
  assert.strictEqual(r.wholeCycles, 3);
  assert.strictEqual(r.partialDays, 16);
  assert.strictEqual(r.cycleDays, 31);
  assert.strictEqual(round2(r.value), round2(31 * (3 + 16 / 31)));
});

test('exactly whole cycles and expired / same-day trades', () => {
  const whole = calc('季付', '30', '2027-03-01', '2026-12-01');
  assert.strictEqual(whole.wholeCycles, 1);
  assert.strictEqual(whole.partialDays, 0);
  assert.strictEqual(round2(whole.value), 30);
  assert.strictEqual(cycleShareText(whole), '100.0%');
  for (const trade of ['2027-03-01', '2027-04-01']) {
    const r = calc('月付', '17.18', '2027-03-01', trade);
    assert.strictEqual(r.daysLeft, 0);
    assert.strictEqual(r.value, 0);
    assert.strictEqual(cycleShareText(r), '0.0%');
  }
});

test('all supported cycle types and invalid input', () => {
  for (const cycle of ['月付', '季付', '半年付', '年付', '两年付', '三年付', '五年付']) {
    const r = calc(cycle, '100', '2030-01-15', '2026-11-03');
    assert.ok(r && r.value > 0 && Number.isFinite(r.value), cycle);
  }
  assert.strictEqual(calc('', '10', '2027-03-01', '2026-11-03'), null);
  assert.strictEqual(calc('月付', '-1', '2027-03-01', '2026-11-03'), null);
  assert.strictEqual(calc('月付', '10', 'bad', '2026-11-03'), null);
});
