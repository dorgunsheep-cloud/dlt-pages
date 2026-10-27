export const DEFAULT_SETTINGS = { shortWindow: 30, longWindow: 100, shortWeight: 30, longWeight: 50, allWeight: 20 };
export const MODES = ['单式', '复式', '前区胆拖', '后区胆拖', '双区胆拖'];
export const pad = n => String(n).padStart(2, '0');
export const range = n => Array.from({ length: n }, (_, i) => i + 1);
const sorted = ns => [...ns].sort((a, b) => a - b);
export function drawSignature(draws) {
  const text = draws.map(r => `${r.issue}:${r.date}:${r.front.join(',')}:${r.back.join(',')}`).join('|');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
export function combination(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < k) return 0;
  let result = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) result = result * (n - i + 1) / i;
  return Math.round(result);
}
export function validateSettings(settings) {
  for (const key of ['shortWindow', 'longWindow']) if (!Number.isInteger(settings[key]) || settings[key] < 1 || settings[key] > 2000) throw new Error('统计窗口须为1—2000的整数');
  if (settings.shortWindow > settings.longWindow) throw new Error('短窗口不能大于长窗口');
  for (const key of ['shortWeight', 'longWeight', 'allWeight']) if (!Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > 100) throw new Error('权重须为0—100');
  if (Math.abs(settings.shortWeight + settings.longWeight + settings.allWeight - 100) > 0.000001) throw new Error('三项权重合计须为100%');
  return settings;
}
function validNumbers(ns, max, label) {
  if (!Array.isArray(ns) || ns.some(n => !Number.isInteger(n) || n < 1 || n > max) || new Set(ns).size !== ns.length) throw new Error(`${label}号码须在01—${max}之间，且区内不能重复`);
  return sorted(ns);
}
export function normalizeDraw(record) {
  if (!record || typeof record !== 'object') throw new Error('开奖记录格式不正确');
  const issue = String(record.issue ?? record.lotteryDrawNum ?? '').trim();
  const date = String(record.date ?? record.lotteryDrawTime ?? '').slice(0, 10);
  if (!/^\d{5}$/.test(issue) || Number(issue.slice(2)) < 1) throw new Error('期号须为五位数字，例如26120');
  const dt = new Date(date + 'T00:00:00Z');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dt.valueOf()) || dt.toISOString().slice(0, 10) !== date) throw new Error(`${issue}：开奖日期无效`);
  if (issue.slice(0, 2) !== date.slice(2, 4)) throw new Error(`${issue}：期号年份与日期不符`);
  // en-CA may be rendered differently on a minimal ICU build; use parts.
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = type => parts.find(p => p.type === type)?.value;
  const shanghaiDate = `${part('year')}-${part('month')}-${part('day')}`;
  if (date > shanghaiDate) throw new Error(`${issue}：不能导入尚未开奖的未来日期`);
  let f = record.front, b = record.back;
  if ((!f || !b) && record.lotteryDrawResult) {
    const a = String(record.lotteryDrawResult).trim().split(/\s+/).map(Number); f = a.slice(0, 5); b = a.slice(5);
  }
  const front = validNumbers(f, 35, '前区'), back = validNumbers(b, 12, '后区');
  if (front.length !== 5 || back.length !== 2) throw new Error(`${issue}：须有5个前区和2个后区号码`);
  return { issue, date, front, back, source: String(record.source ?? 'import'), url: `https://pdf.sporttery.cn/33800/${issue}/${issue}.pdf` };
}
export function mergeDraws(existing, incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) throw new Error('没有可导入的开奖记录');
  if (incoming.length > 10000) throw new Error('一次最多导入10000期');
  const map = new Map(existing.map(r => [r.issue, r]));
  let added = 0;
  for (const raw of incoming) {
    const row = normalizeDraw(raw), old = map.get(row.issue);
    if (old && (old.date !== row.date || old.front.join() !== row.front.join() || old.back.join() !== row.back.join())) throw new Error(`第${row.issue}期与已有数据冲突，请核对官方公告后单独修订`);
    if (!old) { map.set(row.issue, row); added++; }
  }
  const draws = [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.issue.localeCompare(b.issue));
  const dates = new Set();
  for (const row of draws) { if (dates.has(row.date)) throw new Error(`${row.date}存在不同期号的重复记录`); dates.add(row.date); }
  return { draws, added };
}
export function replaceDraw(existing, raw) {
  const row = normalizeDraw(raw);
  if (!existing.some(r => r.issue === row.issue)) throw new Error('只能修订已有期号');
  return mergeDraws(existing.filter(r => r.issue !== row.issue), [row]).draws;
}
export function parseNumberText(text) {
  const clean = String(text).trim();
  if (!clean) return [];
  const tokens = clean.split(/[\s,，、;；]+/);
  if (tokens.some(s => !/^\d{1,2}$/.test(s))) throw new Error('号码用空格或逗号分隔，例如01 06 10 15 32');
  return tokens.map(Number);
}
function csvRows(text) {
  const rows = []; let row = [], cell = '', quote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quote && text[i + 1] === '"') { cell += '"'; i++; } else quote = !quote; }
    else if (ch === ',' && !quote) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quote) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (quote) throw new Error('CSV引号未闭合');
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
export function parseImport(text, filename) {
  text = text.replace(/^\uFEFF/, '');
  if (/\.json$/i.test(filename) || text.trim().startsWith('[') || text.trim().startsWith('{')) {
    let parsed; try { parsed = JSON.parse(text); } catch { throw new Error('JSON文件无法解析'); }
    const list = Array.isArray(parsed) ? parsed : parsed.draws ?? parsed.value?.list ?? parsed.list;
    if (!Array.isArray(list)) throw new Error('JSON须是开奖数组，或含draws字段的备份文件');
    return list;
  }
  const rows = csvRows(text); if (rows.length < 2) throw new Error('CSV至少需要表头和一条数据');
  const heads = rows[0].map(x => x.trim());
  const find = labels => heads.findIndex(h => labels.includes(h));
  const issueCol = find(['期号', 'issue', 'lotteryDrawNum']), dateCol = find(['开奖日期', '日期', 'date', 'lotteryDrawTime']);
  if (issueCol < 0 || dateCol < 0) throw new Error('CSV表头须包含期号、开奖日期');
  const fronts = range(5).map(n => find([`前区${n}`, `front${n}`]));
  const backs = range(2).map(n => find([`后区${n}`, `back${n}`]));
  const fcol = find(['前区', 'front']), bcol = find(['后区', 'back']);
  return rows.slice(1).map(r => ({ issue: r[issueCol], date: r[dateCol], front: fronts.every(n => n >= 0) ? fronts.map(n => Number(r[n])) : parseNumberText(r[fcol]), back: backs.every(n => n >= 0) ? backs.map(n => Number(r[n])) : parseNumberText(r[bcol]), source: 'import' }));
}
export function auditDraws(draws) {
  const missing = [], byYear = {};
  for (const r of draws) { const y = r.issue.slice(0, 2); (byYear[y] ??= []).push(Number(r.issue.slice(2))); }
  for (const [y, ids] of Object.entries(byYear)) {
    const set = new Set(ids); for (let i = Math.min(...ids); i <= Math.max(...ids); i++) if (!set.has(i)) missing.push(y + String(i).padStart(3, '0'));
  }
  return { missing, count: draws.length };
}
export function statistics(draws, settings = DEFAULT_SETTINGS) {
  validateSettings(settings); if (!draws.length) throw new Error('请先导入开奖数据');
  const ordered = [...draws].sort((a, b) => a.date.localeCompare(b.date) || a.issue.localeCompare(b.issue));
  return Object.fromEntries([['front', 35], ['back', 12]].map(([zone, max]) => {
    const rows = range(max).map(n => {
      const count = list => list.reduce((sum, r) => sum + Number(r[zone].includes(n)), 0);
      const short = ordered.slice(-settings.shortWindow), long = ordered.slice(-settings.longWindow);
      const allCount = count(ordered), shortCount = count(short), longCount = count(long);
      const last = ordered.map(r => r[zone].includes(n)).lastIndexOf(true);
      return { number: n, allCount, shortCount, longCount, omission: last < 0 ? ordered.length : ordered.length - last - 1, score: (settings.allWeight * allCount / ordered.length + settings.longWeight * longCount / long.length + settings.shortWeight * shortCount / short.length) / 100 };
    });
    return [zone, rows.sort((a, b) => b.score - a.score || a.number - b.number)];
  }));
}
function combinations(ns, k) {
  const result = [];
  function walk(start, picked) { if (picked.length === k) { result.push([...picked]); return; } for (let i = start; i <= ns.length - (k - picked.length); i++) { picked.push(ns[i]); walk(i + 1, picked); picked.pop(); } }
  walk(0, []); return result;
}
export function calculateBet(bet) {
  const { mode, addition, multiple } = bet;
  if (!MODES.includes(mode)) throw new Error('请选择有效玩法');
  if (!Number.isInteger(multiple) || multiple < 1 || multiple > 99) throw new Error('倍投须为1—99的整数');
  const front = validNumbers(bet.front ?? [], 35, '前区'), back = validNumbers(bet.back ?? [], 12, '后区');
  const frontDan = validNumbers(bet.frontDan ?? [], 35, '前区胆码'), backDan = validNumbers(bet.backDan ?? [], 12, '后区胆码');
  if (frontDan.some(n => front.includes(n)) || backDan.some(n => back.includes(n))) throw new Error('同一区的胆码与拖码不能重复');
  const fd = mode === '前区胆拖' || mode === '双区胆拖', bd = mode === '后区胆拖' || mode === '双区胆拖';
  if (!fd && frontDan.length || !bd && backDan.length) throw new Error('当前玩法不使用该区胆码');
  let f, b;
  if (fd) { if (frontDan.length < 1 || frontDan.length > 4 || front.length + frontDan.length < 6) throw new Error('前区胆拖须选1—4个胆码，胆码与拖码合计至少6个'); f = combination(front.length, 5 - frontDan.length); }
  else { if (front.length < 5) throw new Error('前区至少选择5个号码'); f = combination(front.length, 5); }
  if (bd) { if (backDan.length !== 1 || back.length < 2) throw new Error('后区胆拖须选1个胆码、至少2个拖码'); b = combination(back.length, 1); }
  else { if (back.length < 2) throw new Error('后区至少选择2个号码'); b = combination(back.length, 2); }
  if (mode === '单式' && (front.length !== 5 || back.length !== 2)) throw new Error('单式须选5个前区、2个后区号码');
  if (mode === '复式' && front.length === 5 && back.length === 2) throw new Error('复式至少有一个区超过单式号码数量');
  if (mode === '前区胆拖' && back.length !== 2) throw new Error('前区胆拖的后区须选2个号码，双区扩展请使用双区胆拖');
  if (mode === '后区胆拖' && front.length !== 5) throw new Error('后区胆拖的前区须选5个号码，双区扩展请使用双区胆拖');
  const units = f * b, basicCost = units * 2 * multiple, cost = units * (addition ? 3 : 2) * multiple;
  if (!units) throw new Error('当前号码不能组成有效投注');
  return { units, expandedUnits: units * multiple, cost, basicCost, overLimit: basicCost > 20000 || cost > (addition ? 30000 : 20000) };
}
function chooseDiverse(rows, poolSize, k, count, overlap) {
  const pool = rows.slice(0, poolSize).map(r => r.number).sort((a, b) => a - b);
  const scores = Object.fromEntries(rows.map(r => [r.number, r.score]));
  const candidates = combinations(pool, k).sort((a, b) => b.reduce((s, n) => s + scores[n], 0) - a.reduce((s, n) => s + scores[n], 0) || a.find((n, i) => n !== b[i]) - b[a.findIndex((n, i) => n !== b[i])]);
  const selected = [], used = {}, cap = Math.max(2, Math.ceil(count * k / poolSize) + (count > 5 ? 1 : 0));
  for (let i = 0; i < count; i++) {
    const pick = candidates.find(c => c.every(n => (used[n] ?? 0) < cap) && selected.every(p => c.filter(n => p.includes(n)).length <= overlap));
    if (!pick) throw new Error('当前分散约束无法生成这么多组，请减少方案数量');
    selected.push(pick); for (const n of pick) used[n] = (used[n] ?? 0) + 1;
  }
  return selected;
}
export function recommend(draws, options, settings = DEFAULT_SETTINGS) {
  const { count, mode, addition, multiple } = options;
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('一次生成1—20个方案');
  const stats = statistics(draws, settings); let bets = [];
  if (mode === '单式') {
    // Exactly reproduces the earlier five-ticket rule with default settings.
    const fronts = chooseDiverse(stats.front, count > 5 ? 20 : 15, 5, count, count > 5 ? 3 : 2);
    const backs = chooseDiverse(stats.back, Math.min(12, Math.max(6, count + 1)), 2, count, 1);
    bets = fronts.map((front, i) => ({ mode, front, back: backs[i], frontDan: [], backDan: [], addition, multiple }));
  } else {
    const fd = mode === '前区胆拖' || mode === '双区胆拖', bd = mode === '后区胆拖' || mode === '双区胆拖';
    const fn = options.frontSize, bn = options.backSize, fdc = fd ? options.frontDanSize : 0, bdc = bd ? 1 : 0;
    if (![fn, bn, fdc].every(Number.isInteger) || fn < 5 || fn > 35 || bn < 2 || bn > 12) throw new Error('请检查前后区号码规模');
    if (fd && (fdc < 1 || fdc > 4 || fn < 6)) throw new Error('前区胆拖须选1—4个胆码，前区总数至少6个');
    if (bd && bn < 3) throw new Error('后区胆拖至少需要1胆2拖');
    for (let i = 0; i < count; i++) {
      const fnums = stats.front.map(r => r.number), bnums = stats.back.map(r => r.number);
      const fdan = fnums.slice(0, fdc), bdan = bnums.slice(0, bdc);
      const rotate = (arr, step) => [...arr.slice(step % arr.length), ...arr.slice(0, step % arr.length)];
      const f = rotate(fnums.slice(fdc), i).slice(0, fn - fdc), b = rotate(bnums.slice(bdc), i).slice(0, bn - bdc);
      bets.push({ mode, front: sorted(f), back: sorted(b), frontDan: sorted(fdan), backDan: sorted(bdan), addition, multiple });
    }
  }
  const keys = new Set();
  for (const bet of bets) { const result = calculateBet(bet); if (result.overLimit) throw new Error('单个方案超出单张彩票金额上限，请缩小规模或倍数'); const key = JSON.stringify([bet.front, bet.back, bet.frontDan, bet.backDan]); if (keys.has(key)) throw new Error('该规模无法生成指定数量的不重复方案，请减少方案数'); keys.add(key); }
  return { bets, stats };
}
export function betText(bet) {
  const f = (bet.frontDan?.length ? `[胆 ${bet.frontDan.map(pad).join(' ')}] 拖 ` : '') + bet.front.map(pad).join(' ');
  const b = (bet.backDan?.length ? `[胆 ${bet.backDan.map(pad).join(' ')}] 拖 ` : '') + bet.back.map(pad).join(' ');
  return `${f} + ${b}`;
}
export function normalizePlanBackup(value) {
  const list = Array.isArray(value) ? value : value?.plans;
  if (!Array.isArray(list) || !list.length || list.length > 200) throw new Error('方案备份须包含1—200批记录');
  return list.map(p => {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || p.id.length > 100 || !/^\d{5}$/.test(p.target) || !/^\d{5}$/.test(p.basedIssue) || !Number.isInteger(p.basedCount) || p.basedCount < 1 || !Number.isFinite(Date.parse(p.createdAt))) throw new Error('方案备份的期号、时间或标识格式无效');
    validateSettings(p.settings);
    if (!Array.isArray(p.bets) || !p.bets.length || p.bets.length > 20) throw new Error('每批方案须包含1—20组号码');
    const bets = p.bets.map(b => {
      if (typeof b.addition !== 'boolean' || !Array.isArray(b.frontDan) || !Array.isArray(b.backDan)) throw new Error('方案的追加或胆码字段无效');
      const calc = calculateBet(b); if (calc.overLimit) throw new Error('方案备份包含超额投注');
      return { mode: b.mode, front: sorted(b.front), back: sorted(b.back), frontDan: sorted(b.frontDan), backDan: sorted(b.backDan), addition: b.addition, multiple: b.multiple };
    });
    return { id: p.id, createdAt: p.createdAt, target: p.target, basedIssue: p.basedIssue, basedCount: p.basedCount, settings: { ...p.settings }, bets, origin: String(p.origin ?? '导入方案').slice(0, 30), config: String(p.config ?? '').slice(0, 2000) };
  });
}
export function prizeLevel(frontHits, backHits, issue) {
  const f = frontHits, b = backHits;
  if (!Number.isInteger(f) || !Number.isInteger(b) || f < 0 || f > 5 || b < 0 || b > 2) throw new Error('命中数量无效');
  const old = Number(issue) < 26014;
  if (f === 5 && b === 2) return 1;
  if (f === 5 && b === 1) return 2;
  if (old) {
    if (f === 5) return 3; if (f === 4 && b === 2) return 4; if (f === 4 && b === 1) return 5; if (f === 3 && b === 2) return 6; if (f === 4) return 7;
    if (f === 3 && b === 1 || f === 2 && b === 2) return 8;
    if (f === 3 || f === 2 && b === 1 || b === 2) return 9;
  } else {
    if (f === 5 || f === 4 && b === 2) return 3; if (f === 4 && b === 1) return 4; if (f === 4 || f === 3 && b === 2) return 5;
    if (f === 3 && b === 1 || f === 2 && b === 2) return 6;
    if (f === 3 || f === 2 && b === 1 || b === 2) return 7;
  }
  return 0;
}
export function checkBet(bet, draw) {
  calculateBet(bet);
  const fd = bet.frontDan ?? [], bd = bet.backDan ?? [];
  const fdm = fd.filter(n => draw.front.includes(n)).length, bdm = bd.filter(n => draw.back.includes(n)).length;
  const fm = bet.front.filter(n => draw.front.includes(n)).length, bm = bet.back.filter(n => draw.back.includes(n)).length;
  const fk = 5 - fd.length, bk = 2 - bd.length, levels = {};
  for (let f = 0; f <= fk; f++) for (let b = 0; b <= bk; b++) {
    const ways = combination(fm, f) * combination(bet.front.length - fm, fk - f) * combination(bm, b) * combination(bet.back.length - bm, bk - b);
    if (!ways) continue;
    const level = prizeLevel(f + fdm, b + bdm, draw.issue); if (level) levels[level] = (levels[level] ?? 0) + ways * bet.multiple;
  }
  return levels;
}
