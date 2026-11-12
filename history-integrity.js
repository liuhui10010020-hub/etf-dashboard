/* Completed closes, published-NAV references and timestamped IOPV observations remain separate. */
/* global getMarketDate, validPositive, getStaticHistory, echarts, renderChart, renderStaticHistory, document, window, localStorage, liveData, applyLive */
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
    '513390': [['2026-11-05',2.410],['2026-11-06',2.332],['2026-11-09',2.325],['2026-11-10',2.409],['2026-11-11',2.442],['2026-11-12',2.424]],
    '159655': [['2026-11-05',1.998],['2026-11-06',1.936],['2026-11-09',1.949],['2026-11-10',1.995],['2026-11-11',2.001],['2026-11-12',1.999]],
    '159501': [['2026-11-05',2.132],['2026-11-06',2.069],['2026-11-09',2.055],['2026-11-10',2.110],['2026-11-11',2.123],['2026-11-12',2.107]],
    'QQQ': [['2026-11-04',691.950],['2026-11-05',647.050],['2026-11-06',656.100],['2026-11-09',679.350],['2026-11-10',674.760],['2026-11-11',690.380]]
  }; // Tencent completed-session closes verified 2026-11-12; these are not IOPV.
  const map = new Map(sanitizeHistory(item, getStaticHistory(item), now).map(r => [r[0], r]));
  const mergeRow = row => {
    const old = map.get(row[0]);
    map.set(row[0], old && row[2] === null ? [row[0], row[1], old[2]] : row);
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
  const navMap = new Map(officialNavRows);
  let latestNav = null;
  return rows.map(row => {
    const publishedNav = navMap.get(row[0]);
    if (validPositive(publishedNav)) latestNav = publishedNav;
    if (validPositive(latestNav)) return [row[0], row[1], (row[1] / latestNav - 1) * 100];
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
          .map(point => [getMarketDate({isUsStock:false}, new Date(point.x)), Number(point.y)]);
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
let closeRequestSequence = 0;
function loadTencentCloseHistory(item) {
  // Tencent's documented variable response avoids CORS; unique globals prevent four ticker requests colliding.
  return new Promise(resolve => {
    const symbol = (item.market === 'SH' ? 'sh' : item.market === 'SZ' ? 'sz' : 'us') +
      (item.code === 'QQQ' ? 'QQQ.OQ' : item.code);
    const key = 'etf_close_' + Date.now() + '_' + (++closeRequestSequence);
    const script = document.createElement('script');
    let settled = false;
    const timer = setTimeout(() => finish({rows:[]}), 8000);
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.remove();
      delete window[key];
      resolve(result);
    };
    script.onload = () => {
      try {
        const data = window[key];
        if (!data || data.code !== 0) return finish({rows:[]});
        const node = data.data && data.data[symbol];
        const raw = node && (node.day || node.qfqday);
        const rows = sanitizeHistory(item, (Array.isArray(raw) ? raw : []).map(r => [r[0], Number(r[2]), null]));
        const pan = node && node.pandata;
        const extended = item.isUsStock && pan && validPositive(Number(pan.last)) &&
          /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(pan.time) && ['before','after'].includes(pan.tag)
          ? {price:Number(pan.last), time:pan.time, tag:pan.tag} : null;
        finish({rows, extended});
      } catch (error) {
        console.warn('Tencent close parse failed:', item.code, error.message);
        finish({rows:[]});
      }
    };
    script.onerror = () => finish({rows:[]});
    script.src = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=${key}&param=${symbol},day,,,400,qfq&_=${Date.now()}`;
    document.head.appendChild(script);
  });
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
  const [live, officialNavRows] = await Promise.all([loadTencentCloseHistory(item), loadOfficialNavHistory(item)]);
  const merged = combineHistory(item, live.rows);
  if (live.rows.length) {
    try { localStorage.setItem('etf-closes-v1-' + item.code, JSON.stringify(merged.map(r => [r[0],r[1]]))); } catch {}
  }
  const rows = buildHistoricalReferenceRows(merged, officialNavRows);
  const priceSource = live.rows.length ? '腾讯已收盘行情' : '收盘缓存';
  const navDate = officialNavRows.length ? officialNavRows.at(-1)[0] : '';
  item.historySource = item.isUsStock ? priceSource : priceSource +
    (navDate ? ` / 东财已公布净值截至${navDate}（未披露日沿用参考）` : ' / 历史参考溢价缓存');
  renderChart(item, rows);
  if (live.extended) {
    item.extSnapshot = live.extended;
    if (typeof liveData !== 'undefined' && liveData[item.code]) applyLive(item, liveData[item.code]);
  }
}
Object.assign(window, { recordIopv, loadHistoryAndRender });
