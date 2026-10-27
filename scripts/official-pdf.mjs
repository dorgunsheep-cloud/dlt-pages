import { normalizeDraw, mergeDraws, auditDraws } from '../lib/engine.mjs';

export const announcementUrl = issue => `https://pdf.sporttery.cn/33800/${issue}/${issue}.pdf`;

export function parseAnnouncement(text, expectedIssue) {
  const compact = text.replace(/\s+/g, '');
  const issue = compact.match(/中国体育彩票超级大乐透第(\d{5})期开奖公告/)?.[1];
  const date = compact.match(/开奖日期[：:](20\d{2})年(\d{1,2})月(\d{1,2})日/);
  // Never read the adjacent draw-order row or numbers from the prize table.
  const result = text.match(/本\s*期\s*开\s*奖\s*号\s*码\s*[：:]\s*([\d\s]+?)(?=本\s*期\s*中\s*奖)/);
  if (issue !== expectedIssue || !date || !result) throw new Error(`第${expectedIssue}期官方公告格式或期号校验失败`);
  const numbers = result[1].trim().split(/\s+/).map(Number);
  if (numbers.length !== 7) throw new Error(`第${expectedIssue}期公告须有七个开奖号码`);
  return normalizeDraw({ issue, date: `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`, front: numbers.slice(0, 5), back: numbers.slice(5), source: 'official' });
}

export async function readAnnouncement(issue, fetchImpl = fetch) {
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetchImpl(announcementUrl(issue), { signal: AbortSignal.timeout(15000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 3 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('不是有效的开奖公告PDF');
      const { extractText } = await import('unpdf');
      const { text } = await extractText(bytes, { mergePages: true });
      return parseAnnouncement(text, issue);
    } catch (error) {
      if (attempt === 1 || response?.status === 567) throw new Error(`第${issue}期公告读取失败：${error.message}`);
    }
  }
}

export async function collectAnnouncementUpdates(existing, readPdf = readAnnouncement, now = new Date()) {
  const current = mergeDraws([], existing).draws;
  const anchor = current.at(-1);
  const verified = await readPdf(anchor.issue);
  if (!verified) throw new Error(`无法核对已有第${anchor.issue}期的官方公告`);
  // Recheck the overlap before trusting this source, including on no-update days.
  mergeDraws(current, [verified]);
  const incoming = [verified];
  for (const issue of auditDraws(current).missing) {
    const row = await readPdf(issue);
    if (!row) throw new Error(`官方公告尚不能补齐第${issue}期缺口`);
    incoming.push(row);
  }
  const currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(now)) % 100;
  let year = Number(anchor.issue.slice(0, 2)), serial = Number(anchor.issue.slice(2)) + 1;
  for (let count = 0; count < 160; count++) {
    const issue = `${String(year).padStart(2, '0')}${String(serial).padStart(3, '0')}`;
    const row = await readPdf(issue);
    if (!row) {
      if (year < currentYear) { year++; serial = 1; continue; }
      const result = mergeDraws(current, incoming);
      if (auditDraws(result.draws).missing.length) throw new Error('公告更新后仍有期号缺口');
      return { ...result, pendingIssue: issue };
    }
    if (row.issue !== issue) throw new Error(`公告期号与请求的第${issue}期不符`);
    incoming.push(row);
    serial++;
  }
  throw new Error('待补公告超过160期，本次不写入，请先检查历史数据');
}
