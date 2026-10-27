import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mergeDraws, normalizeDraw, auditDraws } from '../lib/engine.mjs';
import { collectAnnouncementUpdates, readOfficialAnnouncement } from './official-pdf.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ENDPOINT = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry';
export class SourceUnavailableError extends Error {}

export async function collectUpdates(existing, fetchPage) {
  const current = mergeDraws([], existing).draws;
  const first = current[0].date;
  // Include older pages when an imported dataset already has a known hole.
  const knownHoles = auditDraws(current).missing;
  const anchor = knownHoles.length ? [...knownHoles].sort()[0] : current.at(-1).issue;
  const collected = [];
  for (let page = 1; page <= 40; page++) {
    const response = await fetchPage(page);
    if (!response?.success || !Array.isArray(response.value?.list) || !response.value.list.length) throw new SourceUnavailableError(`官方接口第${page}页未返回有效开奖记录`);
    const rows = response.value.list.map(r => normalizeDraw({ ...r, source: 'official' }));
    collected.push(...rows.filter(r => r.date >= first));
    if (rows.at(-1).issue <= anchor || page >= response.value.pages) {
      const result = mergeDraws(current, collected);
      const holes = auditDraws(result.draws).missing;
      if (holes.length) throw new Error(`更新后仍有年内期号缺口：${holes.slice(0, 10).join('、')}`);
      return result;
    }
  }
  throw new Error('读取超过40页仍未找到历史边界，拒绝写入不完整数据');
}

export async function officialPage(page) {
  const url = `${ENDPOINT}?gameNo=85&provinceId=0&pageSize=100&pageNo=${page}`;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.lottery.gov.cn/' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) { lastError = error; if (/HTTP 567/.test(error.message)) break; }
  }
  throw new SourceUnavailableError(`中国体彩动态接口读取失败：${lastError?.message ?? '连接超时'}`);
}

export async function resolveUpdates(old, fetchPage = officialPage, readPdf = readOfficialAnnouncement, now = new Date()) {
  try { return { ...await collectUpdates(old, fetchPage), method: 'api', message: '已通过官方动态接口核对' }; }
  catch (error) {
    // A conflicting or invalid draw is a data error, never a reason to hide it with another source.
    if (!(error instanceof SourceUnavailableError)) throw error;
    const result = await collectAnnouncementUpdates(old, readPdf, now);
    return { ...result, method: 'announcement', message: `${error.message}；已通过体彩官方公告备用通道核对（优先广东体彩静态公告），暂未读到第${result.pendingIssue}期公告（404或官方未发布页），将在下次任务继续检查` };
  }
}

export async function updateData({ root = ROOT, fetchPage = officialPage, readPdf = readOfficialAnnouncement, now = new Date() } = {}) {
  const source = path.join(root, 'data/draws.json');
  const old = JSON.parse(await fs.readFile(source, 'utf8'));
  let previous = {};
  try { previous = JSON.parse(await fs.readFile(path.join(root, 'public/data/status.json'), 'utf8')); } catch {}
  let result;
  try { result = await resolveUpdates(old, fetchPage, readPdf, now); }
  catch (error) {
    const status = { ...previous, state: 'failed', checkedAt: now.toISOString(), latestIssue: old.at(-1).issue, latestDate: old.at(-1).date, count: old.length, message: `自动更新未完成：${error.message}。已保留此前数据，将在下次任务重试。` };
    await writeStatus(root, status);
    throw error;
  }
  const text = JSON.stringify(result.draws, null, 2) + '\n';
  // Validation completes before any file is replaced; temporary writes avoid truncation.
  const destinations = [source, path.join(root, 'public/data/draws.json')];
  await Promise.all(destinations.map(p => fs.writeFile(p + '.tmp', text)));
  for (const destination of destinations) await fs.rename(destination + '.tmp', destination);
  const metadata = { source: result.method === 'announcement' ? '体彩官方公告（广东体彩静态页面 / 全国体彩PDF）' : '中国体育彩票官方开奖接口', state: 'ok', method: result.method, checkedAt: now.toISOString(), fetchedAt: now.toISOString(), latestIssue: result.draws.at(-1).issue, latestDate: result.draws.at(-1).date, count: result.draws.length, message: result.message };
  await writeStatus(root, metadata);
  console.log(metadata.message);
  console.log(`官方核对完成：新增${result.added}期，共${result.draws.length}期，截至第${metadata.latestIssue}期（${metadata.latestDate}）。`);
  return metadata;
}

async function writeStatus(root, status) {
  const dest = path.join(root, 'public/data/status.json');
  await fs.writeFile(dest + '.tmp', JSON.stringify(status, null, 2) + '\n');
  await fs.rename(dest + '.tmp', dest);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateData().catch(error => { console.error(error.message); process.exitCode = 1; });
}
