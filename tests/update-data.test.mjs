import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectUpdates } from '../scripts/update-data.mjs';
import { mergeDraws } from '../lib/engine.mjs';
const all = JSON.parse(fs.readFileSync(new URL('../data/draws.json', import.meta.url)));
const base = all.filter(r => r.issue <= '26120');
const raw = r => ({ lotteryDrawNum: r.issue, lotteryDrawTime: r.date, lotteryDrawResult: [...r.front, ...r.back].join(' ') });
const page = (list, pages = 1) => ({ success: true, value: { list: list.map(raw), pages } });
test('没有新增期号时正确去重', async () => {
  const result = await collectUpdates(base, async () => page(base.slice(-100).reverse()));
  assert.equal(result.added, 0); assert.equal(result.draws.length, 752);
});
test('跨页更新使用重叠边界，分页数据不覆盖原记录', async () => {
  let calls = 0;
  const existing = base.slice(0, -2);
  const result = await collectUpdates(existing, async n => { calls++; return n === 1 ? page(base.slice(-2).reverse(), 2) : page(base.slice(-5, -2).reverse(), 2); });
  assert.equal(calls, 2); assert.equal(result.added, 2); assert.equal(result.draws.at(-1).issue, '26120');
});
test('冲突、空页及缺期整批拒绝，不修改传入数据', async () => {
  const copy = JSON.stringify(base);
  const bad = { ...base.at(-1), front: [1, 2, 3, 4, 5] };
  await assert.rejects(collectUpdates(base, async () => page([bad])), /冲突/);
  await assert.rejects(collectUpdates(base, async () => ({ success: true, value: { list: [] } })), /有效/);
  const hole = base.filter(r => r.issue !== '26119');
  await assert.rejects(collectUpdates(hole, async () => page([base.at(-1)])), /缺口/);
  assert.equal(JSON.stringify(base), copy);
});
test('可恢复已有期号缺口', async () => {
  const existing = base.filter(r => r.issue !== '26119');
  const result = await collectUpdates(existing, async () => page(base.slice(-10).reverse()));
  assert.equal(result.added, 1); assert.equal(result.draws.length, 752);
});
test('实际随包数据全部合法，且不早于旧样本末期', () => {
  const result = mergeDraws([], all);
  assert(result.draws.length >= 752);
  assert(result.draws.at(-1).issue >= '26120');
});
