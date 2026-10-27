import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mergeDraws, normalizeDraw, auditDraws } from '../lib/engine.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ENDPOINT = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry';

export async function collectUpdates(existing, fetchPage) {
  const current = mergeDraws([], existing).draws;
  const first = current[0].date;
  // Include older pages when an imported dataset already has a known hole.
  const knownHoles = auditDraws(current).missing;
  const anchor = knownHoles.length ? [...knownHoles].sort()[0] : current.at(-1).issue;
  const collected = [];
  for (let page = 1; page <= 40; page++) {
    const response = await fetchPage(page);
    if (!response?.success || !Array.isArray(response.value?.list) || !response.value.list.length) throw new Error(`官方接口第${page}页未返回有效开奖记录`);
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

async function officialPage(page) {
  const url = `${ENDPOINT}?gameNo=85&provinceId=0&pageSize=100&pageNo=${page}`;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.lottery.gov.cn/' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) { lastError = error; }
  }
  throw new Error(`中国体彩数据读取失败：${lastError?.message ?? '连接超时'}。现有文件保持不变。`);
}

export async function updateData() {
  const source = path.join(ROOT, 'data/draws.json');
  const old = JSON.parse(await fs.readFile(source, 'utf8'));
  const result = await collectUpdates(old, officialPage);
  const text = JSON.stringify(result.draws, null, 2) + '\n';
  // Validation completes before any file is replaced; temporary writes avoid truncation.
  const destinations = [source, path.join(ROOT, 'public/data/draws.json')];
  await Promise.all(destinations.map(p => fs.writeFile(p + '.tmp', text)));
  for (const destination of destinations) await fs.rename(destination + '.tmp', destination);
  const metadata = { source: '中国体育彩票官方开奖接口', fetchedAt: new Date().toISOString(), latestIssue: result.draws.at(-1).issue, latestDate: result.draws.at(-1).date, count: result.draws.length };
  await fs.writeFile(path.join(ROOT, 'public/data/status.json.tmp'), JSON.stringify(metadata, null, 2) + '\n');
  await fs.rename(path.join(ROOT, 'public/data/status.json.tmp'), path.join(ROOT, 'public/data/status.json'));
  console.log(`官方核对完成：新增${result.added}期，共${result.draws.length}期，截至第${metadata.latestIssue}期（${metadata.latestDate}）。`);
  return metadata;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateData().catch(error => { console.error(error.message); process.exitCode = 1; });
}
