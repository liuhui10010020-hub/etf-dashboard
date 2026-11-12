/* Close-price history, historical reference premiums, and timestamp-matched IOPV observations use separate series. */
/* global getMarketDate, validPositive, getStaticHistory, echarts, renderChart, renderStaticHistory, document, window */
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
    .map(row => [row[0], Number(row[1]), row[2] !== null && row[2] !== undefined && Number.isFinite(Number(row[2])) ? Number(row[2]) : null]);
}
function combineHistory(item, rows, now = new Date()) {
  const latestCloses = {
    '513390': [['2026-11-05',2.410],['2026-11-06',2.332],['2026-11-09',2.325],['2026-11-10',2.409],['2026-11-11',2.442]],
    '159655': [['2026-11-05',1.998],['2026-11-06',1.936],['2026-11-09',1.949],['2026-11-10',1.995],['2026-11-11',2.001]],
    '159501': [['2026-11-05',2.132],['2026-11-06',2.069],['2026-11-09',2.055],['2026-11-10',2.110],['2026-11-11',2.123]],
    'QQQ': [['2026-11-05',647.050],['2026-11-06',656.100],['2026-11-09',679.350],['2026-11-10',674.760],['2026-11-11',690.380]]
  }; // Tencent completed-session closes, verified 2026-11-11 after A-share close; never IOPV values.
  const map = new Map(sanitizeHistory(item, getStaticHistory(item), now).map(r => [r[0], r]));
  const mergeRow = row => {
    const old = map.get(row[0]);
    map.set(row[0], old && row[2] === null ? [row[0], row[1], old[2]] : row);
  };
  sanitizeHistory(item, latestCloses[item.code] || [], now).forEach(mergeRow);
  sanitizeHistory(item, rows, now).forEach(mergeRow);
  return Array.from(map.values()).sort((a,b) => a[0].localeCompare(b[0]));
}
function buildHistoricalReferenceRows(rows, officialNavRows = []) {
  if (!Array.isArray(officialNavRows) || !officialNavRows.length) return rows;
  const navMap = new Map(officialNavRows);
  let latestNav = null;
  return rows.map(row => {
    const publishedNav = navMap.get(row[0]);
    if (validPositive(publishedNav)) latestNav = publishedNav;
    if (validPositive(latestNav)) {
      return [row[0], row[1], (row[1] / latestNav - 1) * 100];
    }
    return [row[0], row[1], row[2] ?? null];
  });
}
let officialNavQueue = Promise.resolve();
function loadOfficialNavHistory(item) {
  if (item.isUsStock) return Promise.resolve([]);
  officialNavQueue = officialNavQueue.then(() => new Promise(resolve => {
    const previousGlobal = window.Data_netWorthTrend;
    const script = document.createElement('script');
    let settled = false;
    const timeout = setTimeout(() => finish([]), 8000);
    const finish = rows => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.Data_netWorthTrend = previousGlobal;
      script.remove();
      resolve(rows);
    };
    script.onload = () => {
      try {
        const rows = (window.Data_netWorthTrend || [])
          .filter(point => point && Number.isFinite(point.x) && validPositive(Number(point.y)))
          .map(point => {
            const date = new Date(point.x);
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            return [`${yyyy}-${mm}-${dd}`, Number(point.y)];
          });
        finish(rows);
      } catch (error) {
        console.warn('Official NAV parse failed:', item.code, error.message);
        finish([]);
      }
    };
    script.onerror = () => {
      console.warn('Official NAV unavailable:', item.code);
      finish([]);
    };
    script.src = `https://fund.eastmoney.com/pingzhongdata/${item.code}.js?v=${Date.now()}`;
    document.head.appendChild(script);
  })).catch(() => []);
  return officialNavQueue;
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
  renderStaticHistory(item);
  const officialNavRows = await loadOfficialNavHistory(item);
  const rows = buildHistoricalReferenceRows(combineHistory(item, []), officialNavRows);
  item.historySource = item.isUsStock
    ? '收盘缓存'
    : (officialNavRows.length ? '收盘缓存 / 东财已公布净值' : '收盘缓存');
  renderChart(item, rows);
}

// Public helpers used by index.html's classic scripts.
Object.assign(window, { recordIopv, loadHistoryAndRender });
