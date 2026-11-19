/* Completed closes, published-NAV references and timestamped IOPV observations remain separate. */
/* global getMarketDate, validPositive, getStaticHistory, getLatestStaticNavSnapshot, echarts, renderChart, renderStaticHistory, document, window, localStorage */
/* exported recordIopv, loadHistoryAndRender */
function sanitizeHistory(item, raw, now = new Date()) {
  const date = getMarketDate(item, now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: item.isUsStock ? 'America/New_York' : 'Asia/Shanghai',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const part = type => Number(parts.find(p => p.type === type).value);
  const marketClosed = part('hour') * 60 + part('minute') >= (item.isUsStock ? 960 : 900);
  return (Array.isArray(raw) ? raw : []).filter(row => Array.isArray(row) &&
    /^\d{4}-\d{2}-\d{2}$/.test(row[0]) && row[0] >= '2026-01-01' &&
    (row[0] < date || (row[0] === date && marketClosed)) && validPositive(Number(row[1])))
    .map(row => [row[0], Number(row[1]), row[2] !== null && row[2] !== undefined && Number.isFinite(Number(row[2])) ? Number(row[2]) : null]);
}
function combineHistory(item, rows, now = new Date()) {
  const latestCloses = {
    '513390': [['2026-11-05',2.410],['2026-11-06',2.332],['2026-11-09',2.325],['2026-11-10',2.409],['2026-11-11',2.442],['2026-11-12',2.424],['2026-11-13',2.435],['2026-11-16',2.380],['2026-11-17',2.351],['2026-11-18',2.369]],
    '159655': [['2026-11-05',1.998],['2026-11-06',1.936],['2026-11-09',1.949],['2026-11-10',1.995],['2026-11-11',2.001],['2026-11-12',1.999],['2026-11-13',2.004],['2026-11-16',1.970],['2026-11-17',1.937],['2026-11-18',1.941]],
    '159501': [['2026-11-05',2.132],['2026-11-06',2.069],['2026-11-09',2.055],['2026-11-10',2.110],['2026-11-11',2.123],['2026-11-12',2.107],['2026-11-13',2.107],['2026-11-16',2.070],['2026-11-17',2.047],['2026-11-18',2.048]],
    'QQQM': [['2026-11-04',284.920],['2026-11-05',266.850],['2026-11-06',270.220],['2026-11-09',279.520],['2026-11-10',277.870],['2026-11-11',284.230],['2026-11-12',283.390],['2026-11-13',279.970],['2026-11-16',272.490],['2026-11-17',270.420],['2026-11-18',271.580]]
  }; // Completed-session closes verified 2026-11-19, including US 11-18 close; these are not IOPV.
  const map = new Map(sanitizeHistory(item, getStaticHistory(item), now).map(r => [r[0], r]));
  const mergeRow = row => {
    const old = map.get(row[0]);
    // Preserve a premium only when its price is unchanged; otherwise it is a different ratio.
    map.set(row[0], old && row[2] === null && old[1] === row[1] ? [row[0], row[1], old[2]] : row);
  };
  sanitizeHistory(item, latestCloses[item.code] || [], now).forEach(mergeRow);
  try {
    sanitizeHistory(item, JSON.parse(localStorage.getItem('etf-closes-v1-' + item.code) || '[]'), now).forEach(mergeRow);
  } catch { /* Corrupt or unavailable browser cache must not block verified closes. */ }
  sanitizeHistory(item, rows, now).forEach(mergeRow);
  return Array.from(map.values()).sort((a,b) => a[0].localeCompare(b[0]));
}
function buildHistoricalReferenceRows(rows, officialNavRows = []) {
  if (!Array.isArray(officialNavRows) || !officialNavRows.length) return rows;
  const navRows = officialNavRows.filter(row => Array.isArray(row) &&
    /^\d{4}-\d{2}-\d{2}$/.test(row[0]) && validPositive(Number(row[1])))
    .map(row => [row[0], Number(row[1])]).sort((a,b) => a[0].localeCompare(b[0]));
  let latestNav = null;
  let index = 0;
  return rows.map(row => {
    // As-of matching handles sparse disclosures without applying a later NAV to earlier prices.
    while (index < navRows.length && navRows[index][0] <= row[0]) latestNav = navRows[index++][1];
    if (validPositive(latestNav)) return [row[0], row[1], (row[1] / latestNav - 1) * 100];
    return [row[0], row[1], row[2] ?? null];
  });
}
let officialNavQueue = Promise.resolve();
function loadOfficialNavHistory(item) {
  if (item.isUsStock) return Promise.resolve([]);
  officialNavQueue = officialNavQueue.then(() => new Promise(resolve => {
    const previousGlobal = window.Data_netWorthTrend;
    window.Data_netWorthTrend = undefined;
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
        const rows = (Array.isArray(window.Data_netWorthTrend) ? window.Data_netWorthTrend : [])
          .filter(point => point && Number.isFinite(point.x) && validPositive(Number(point.y)))
          .map(point => [getMarketDate({isUsStock:false}, new Date(point.x)), Number(point.y)])
          .sort((a,b) => a[0].localeCompare(b[0]));
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
function recordCompletedClose(item, quote, now = new Date()) {
  // Reuse the working quote feed; never rely on the blocked K-line JSONP endpoint.
  // Only a dated, valid regular-session closing quote can become a daily close.
  if (!quote || quote.stale || quote.suspended || quote.missingPrice || quote.noTrades || !validPositive(quote.f43)) return false;
  const stamp = quote.quoteTime || '';
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp)) return false;
  const minutes = Number(stamp.slice(11,13)) * 60 + Number(stamp.slice(14,16));
  if (minutes < (item.isUsStock ? 960 : 900) || (item.isUsStock && minutes > 970)) return false;
  if (!item.isUsStock && stamp.slice(0,10) !== getMarketDate(item, now)) return false;
  const sampled = sanitizeHistory(item, [[stamp.slice(0,10), quote.f43, null]], now);
  if (!sampled.length) return false;
  const rows = combineHistory(item, sampled, now);
  try { localStorage.setItem('etf-closes-v1-' + item.code, JSON.stringify(rows.map(r => [r[0],r[1]]))); } catch {}
  item.hasSampledClose = true;
  const container = document.getElementById('chart-' + item.code);
  const chart = container ? echarts.getInstanceByDom(container) : null;
  if (chart) renderChart(item, buildHistoricalReferenceRows(rows, item.officialNavRows || []));
  return true;
}
function readIopvArchive(item, now = new Date()) {
  // Actual Tencent responses captured during close patrols, not backfilled NAV.
  const verified = {
    '513390': [['2026-11-16 15:10:20', 2.380, 2.0973], ['2026-11-17 15:08:26', 2.351, 2.0411], ['2026-11-18 15:10:37', 2.369, 2.0261]],
    '159655': [['2026-11-16 15:10:15', 1.970, 1.8370], ['2026-11-17 15:08:30', 1.937, 1.8016], ['2026-11-18 15:10:18', 1.941, 1.7822]],
    '159501': [['2026-11-16 15:10:00', 2.070, 1.7555], ['2026-11-17 15:08:30', 2.047, 1.7085], ['2026-11-18 15:10:15', 2.048, 1.6959]]
  };
  let local = [];
  try { local = JSON.parse(localStorage.getItem('etf-iopv-v1-' + item.code) || '[]'); } catch {}
  const merged = [...(verified[item.code] || []), ...(Array.isArray(local) ? local : [])];
  const rows = merged.filter(r => Array.isArray(r) &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r[0]) &&
    Date.parse(r[0].replace(' ', 'T') + '+08:00') <= now.getTime() &&
    validPositive(r[1]) && validPositive(r[2]));
  return Array.from(new Map(rows.map(r => [r[0], r])).values())
    .sort((a,b) => a[0].localeCompare(b[0])).slice(-1000);
}
function recordIopv(item, quote) {
  if (item.isUsStock || quote.stale || quote.suspended || quote.noTrades || quote.missingPrice ||
      !item.navIsLatest || !quote.quoteTime || !validPositive(item.nav)) return;
  const stamp = quote.quoteTime.replace(' ', 'T') + '+08:00';
  const navStamp = item.navFallbackDate || '';
  if (navStamp.slice(0,10) !== quote.quoteTime.slice(0,10) ||
      Math.abs(Date.parse(navStamp.replace(' ', 'T') + '+08:00') - Date.parse(stamp)) > 180000 ||
      Math.abs(Date.parse(stamp) - Date.now()) > 180000) return;
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
  const liveNavRows = await loadOfficialNavHistory(item);
  const cached = typeof getLatestStaticNavSnapshot === 'function' ? getLatestStaticNavSnapshot(item.code) : null;
  const navMap = new Map(cached ? [[cached.date, cached.nav]] : []);
  liveNavRows.forEach(row => navMap.set(row[0], row[1]));
  const officialNavRows = Array.from(navMap).sort((a,b) => a[0].localeCompare(b[0]));
  item.officialNavRows = officialNavRows;
  const rows = buildHistoricalReferenceRows(combineHistory(item, []), officialNavRows);
  const priceSource = item.hasSampledClose ? '已核验收盘缓存 / 行情实采' : '已核验收盘缓存';
  const navDate = officialNavRows.length ? officialNavRows.at(-1)[0] : '';
  item.historySource = item.isUsStock ? priceSource : priceSource +
    (navDate ? ` / 东财已公布净值截至${navDate}（未披露日沿用参考）` : ' / 历史参考溢价缓存');
  renderChart(item, rows);
}
Object.assign(window, { recordIopv, recordCompletedClose, loadHistoryAndRender });
