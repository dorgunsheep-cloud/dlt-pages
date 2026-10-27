import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectUpdates, resolveUpdates, SourceUnavailableError, updateData } from '../scripts/update-data.mjs';
import { parseAnnouncement, collectAnnouncementUpdates, readAnnouncement } from '../scripts/official-pdf.mjs';
import os from 'node:os';
import path from 'node:path';
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

const announcement = `中国体育彩票超级大乐透\n第26120期开奖公告\n开奖日期：2026年10月21日\n本期出球顺序：32 15 10 06 01 04 03\n本期开奖号码：01 06 10 15 32 03 04\n本期中奖情况\n一等奖 100注`;
test('公告只提取开奖号码行，校验彩种、期号、日期和号码', () => {
  const row = parseAnnouncement(announcement, '26120');
  assert.deepEqual(row.front, [1, 6, 10, 15, 32]); assert.deepEqual(row.back, [3, 4]);
  assert.equal(row.date, '2026-10-21'); assert.equal(row.source, 'official');
  for (const text of [announcement.replace('超级大乐透', '排列5'), announcement.replace('01 06 10', '01 01 10'), announcement.replace('2026年10月21日', '2027年10月21日'), announcement.replace('本期开奖号码：', '其他信息：')]) assert.throws(() => parseAnnouncement(text, '26120'));
  assert.throws(() => parseAnnouncement(announcement, '26121'));
  assert.throws(() => parseAnnouncement(announcement.replace('03 04\n本期中奖', '03 04 05\n本期中奖'), '26120'), /七个/);
});
test('567自动切换官方公告，连续补齐新增期号至404', async () => {
  const calls = [];
  const old = base.slice(0, -2);
  const result = await resolveUpdates(old, async () => { throw new SourceUnavailableError('HTTP 567'); }, async issue => { calls.push(issue); return base.find(r => r.issue === issue) ?? null; });
  assert.equal(result.added, 2); assert.equal(result.method, 'pdf');
  assert.deepEqual(calls, ['26118','26119','26120','26121']);
  assert.match(result.message, /567/); assert.match(result.message, /404/);
});
test('公告通道无新增时仍核对最新一期，且能补齐历史缺口', async () => {
  const read = async issue => base.find(r => r.issue === issue) ?? null;
  assert.equal((await collectAnnouncementUpdates(base, read)).added, 0);
  assert.equal((await collectAnnouncementUpdates(base.filter(r => r.issue !== '26119'), read)).added, 1);
  await assert.rejects(collectAnnouncementUpdates(base, async () => null), /无法核对/);
  await assert.rejects(collectAnnouncementUpdates(base, async issue => ({...base.at(-1),issue,front:[1,2,3,4,5]})), /冲突/);
});
test('公告404与网络拒绝/伪PDF严格区分', async () => {
  assert.equal(await readAnnouncement('26121', async () => new Response('', {status:404})), null);
  await assert.rejects(readAnnouncement('26121', async () => new Response('', {status:567})), /567/);
  await assert.rejects(readAnnouncement('26121', async () => new Response('<html>错误</html>')), /PDF/);
});
test('原接口数据冲突时不掩盖错误，不切换来源', async () => {
  let called = false;
  await assert.rejects(resolveUpdates(base, async () => page([{...base.at(-1),front:[1,2,3,4,5]}]), async () => { called=true; }), /冲突/);
  assert.equal(called, false);
});
test('公告通道支持跨年，未发布新年度公告不伪造记录', async () => {
  const old = [{issue:'25001',date:'2025-01-01',front:[1,2,3,4,5],back:[1,2]}];
  const newRow = {...old[0],issue:'26001',date:'2026-01-01'};
  const calls = [];
  const result = await collectAnnouncementUpdates(old, async issue => { calls.push(issue); return issue==='25001'?old[0]:issue==='26001'?newRow:null; });
  assert.equal(result.added, 1); assert.deepEqual(calls,['25001','25002','26001','26002']);
});
test('两通道失败保留两个数据文件，发布失败状态；成功恢复后清除失败', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dlt-update-'));
  try {
    fs.mkdirSync(path.join(root,'data')); fs.mkdirSync(path.join(root,'public/data'),{recursive:true});
    for (const relative of ['data/draws.json','public/data/draws.json']) fs.writeFileSync(path.join(root,relative),JSON.stringify(base));
    const before = fs.readFileSync(path.join(root,'data/draws.json'),'utf8');
    const fetchPage = async () => {throw new SourceUnavailableError('HTTP 567');};
    await assert.rejects(updateData({root,fetchPage,readPdf:async () => {throw new Error('PDF网络失败');}}),/PDF网络失败/);
    for (const relative of ['data/draws.json','public/data/draws.json']) assert.equal(fs.readFileSync(path.join(root,relative),'utf8'),before);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'public/data/status.json'))).state,'failed');
    const report = await updateData({root,fetchPage,readPdf:async issue=>base.find(r=>r.issue===issue)??null});
    assert.equal(report.state,'ok'); assert.equal(report.method,'pdf'); assert.equal(report.count,752);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
