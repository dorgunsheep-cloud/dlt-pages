import { normalizeDraw, mergeDraws, auditDraws } from '../lib/engine.mjs';

export const announcementUrl = issue => `https://pdf.sporttery.cn/33800/${issue}/${issue}.pdf`;
export const provincialUrl = issue => `https://www.gdlottery.cn/f_html/kjgg/P085_${issue}.html`;

async function fetchTextResponse(url, fetchImpl) {
  try { return await fetchImpl(url, { signal: AbortSignal.timeout(15000) }); }
  catch (error) {
    if (fetchImpl !== fetch) throw error;
    // Some regional HTTPS servers are incompatible with Node's TLS client.
    // curl still verifies certificates using the OS trust store; never use -k.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    try {
      const { stdout } = await promisify(execFile)('curl', ['--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--max-time','15','--write-out','\n%{http_code}',url], { encoding:'utf8', maxBuffer:3*1024*1024, timeout:17000, windowsHide:true });
      const boundary = stdout.lastIndexOf('\n');
      return new Response(stdout.slice(0,boundary), { status:Number(stdout.slice(boundary+1)) });
    } catch (curlError) { throw new Error(`HTTPS读取失败：${error.cause?.code ?? error.message}；系统HTTPS客户端：${curlError.message}`); }
  }
}

export function createJiangsuReader(fetchImpl = fetch) {
  let index;
  return async issue => {
    if (!index) {
      const response = await fetchTextResponse('https://www.js-lottery.com/wfzq/dlt', fetchImpl);
      if (!response.ok) throw new Error(`江苏体彩列表 HTTP ${response.status}`);
      const html = await response.text();
      const select = html.match(/<select\b[^>]*\bid=["']lottoList["'][^>]*>([\s\S]*?)<\/select>/i)?.[1];
      if (!select) throw new Error('江苏体彩公告列表格式变化');
      index = new Map([...select.matchAll(/<option\s+value=["'](\d+)["'][^>]*>\s*(\d{5})\s*<\/option>/gi)].map(m => [m[2],m[1]]));
      if (!index.size) throw new Error('江苏体彩公告列表为空');
    }
    const id = index.get(issue);
    if (!id) {
      if (issue > [...index.keys()].sort().at(-1)) return null;
      throw new Error(`江苏体彩近期列表中没有第${issue}期，不能跳过历史边界`);
    }
    const response = await fetchTextResponse(`https://www.js-lottery.com/cms/post-${id}.html`, fetchImpl);
    if (!response.ok) throw new Error(`江苏体彩第${issue}期 HTTP ${response.status}`);
    return parseHtmlAnnouncement(await response.text(), issue);
  };
}
const jiangsuReader = createJiangsuReader();

export function parseHtmlAnnouncement(html, issue) {
  const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return parseAnnouncement(text, issue);
}

// The provincial centre republishes the same national draw in static HTML.
// A 404 here means this source has no new announcement yet; other failures
// may use the national PDF source. Malformed/conflicting data is never hidden.
export async function readOfficialAnnouncement(issue, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchTextResponse(provincialUrl(issue), fetchImpl);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    try { return await (fetchImpl === fetch ? jiangsuReader : createJiangsuReader(fetchImpl))(issue); }
    catch (jsError) {
      try { return await readAnnouncement(issue, fetchImpl); }
      catch (pdfError) { throw new Error(`广东体彩公告：${error.message}；江苏体彩公告：${jsError.message}；全国体彩公告：${pdfError.message}`); }
    }
  }
  const html = await response.text();
  if (html.length > 3 * 1024 * 1024) throw new Error(`第${issue}期公告超出大小限制`);
  // This site serves its specific 404 template with HTTP 200 for unpublished issues.
  if (/<div\s+class=["']error["'][^>]*>[\s\S]*?<img[^>]+src=["']images\/404\.jpg["']/i.test(html) && !html.includes('本期开奖号码')) return null;
  return parseHtmlAnnouncement(html, issue);
}

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

export async function collectAnnouncementUpdates(existing, readPdf = readOfficialAnnouncement, now = new Date()) {
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
