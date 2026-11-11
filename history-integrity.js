/* Close-price history and timestamp-matched IOPV observations use separate series. */
/* global getMarketDate, validPositive, getStaticHistory, echarts, renderChart, renderStaticHistory */
/* exported recordIopv, loadHistoryAndRender */
function sanitizeHistory(item, raw, now = new Date()) {
  const date = getMarketDate(item, now);
  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: item.isUsStock ? 'America/New_York' : 'Asia/Shanghai',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const hours = Number(timeParts.find(p => p.type === 'hour').value);
  const minutes = Number(timeParts.find(p => p.type === 'minute').value);
  const marketClosed = hours * 60 + minutes >= (item.isUsStock ? 960 : 900);
  return raw.filter(row => row[0] >= '2026-01-01' &&
    (row[0] < date || (row[0] === date && marketClosed)) && validPositive(Number(row[1])))
    .map(row => [row[0], Number(row[1]), null]);
}
function combineHistory(item, rows, now = new Date()) {
  const latestCloses = {
    '513390': [['2026-11-06',2.332],['2026-11-09',2.325],['2026-11-10',2.409],['2026-11-11',2.442]],
    '159655': [['2026-11-06',1.936],['2026-11-09',1.949],['2026-11-10',1.995],['2026-11-11',2.001]],
    '159501': [['2026-11-06',2.069],['2026-11-09',2.055],['2026-11-10',2.110],['2026-11-11',2.123]],
    'QQQ': [['2026-11-05',647.050],['2026-11-06',656.100],['2026-11-09',679.350],['2026-11-10',674.760]]
  }; // Tencent completed-session closes, verified 2026-11-11 after A-share close; never IOPV values.
  const map = new Map(sanitizeHistory(item, getStaticHistory(item), now).map(r => [r[0], r]));
  sanitizeHistory(item, latestCloses[item.code] || [], now).forEach(row => map.set(row[0], row));
  sanitizeHistory(item, rows, now).forEach(row => map.set(row[0], row));
  return Array.from(map.values()).sort((a,b) => a[0].localeCompare(b[0]));
}
function readIopvArchive(item) {
  try {
    const rows = JSON.parse(localStorage.getItem('etf-iopv-v1-' + item.code) || '[]');
    return Array.isArray(rows) ? rows.filter(r => Array.isArray(r) &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r[0]) &&
      validPositive(r[1]) && validPositive(r[2])).slice(-1000) : [];
  } catch { return []; }
}
function recordIopv(item, quote) {
  if (item.isUsStock || quote.stale || !item.navIsLatest || !quote.quoteTime || !validPositive(item.nav)) return;
  const stamp = quote.quoteTime.replace(' ', 'T') + '+08:00';
  if (Math.abs(Date.parse(stamp) - Date.now()) > 180000) return;
  const rows = readIopvArchive(item);
  const row = [quote.quoteTime, quote.f43, item.nav];
  const last = rows[rows.length - 1];
  if (last && last[0] === row[0]) rows[rows.length - 1] = row;
  else rows.push(row);
  try { localStorage.setItem('etf-iopv-v1-' + item.code, JSON.stringify(rows.slice(-1000))); } catch {}
  const container = document.getElementById('chart-' + item.code);
  const chart = container ? echarts.getInstanceByDom(container) : null;
  if (chart && chart.__priceRows) renderChart(item, chart.__priceRows);
}
async function loadHistoryAndRender(item) {
  renderStaticHistory(item); // Render dated fallback immediately while the network loads.
  const symbol = (item.market === 'SH' ? 'sh' : item.market === 'SZ' ? 'sz' : 'us') +
    (item.code === 'QQQ' ? 'QQQ.OQ' : item.code);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,400,qfq&_=${Date.now()}`, { signal: controller.signal });
    if (!response.ok) throw new Error('History HTTP ' + response.status);
    const result = await response.json();
    const data = result.data && result.data[symbol];
    const raw = data && (data.day || data.qfqday);
    if (!Array.isArray(raw) || !raw.length) throw new Error('Empty history');
    const rows = combineHistory(item, raw.map(k => [k[0], Number(k[2]), null]));
    item.historySource = '腾讯K线 / 本地收盘缓存';
    renderChart(item, rows);
  } catch (error) {
    item.historySource = '历史缓存 · 实时历史接口暂不可用';
    renderStaticHistory(item);
    console.warn('History fallback:', item.code, error.message);
  } finally { clearTimeout(timer); }
}

// Public helpers used by index.html's classic scripts.
Object.assign(window, { recordIopv, loadHistoryAndRender });
