/* Shared, timezone-independent quote validation. Missing values are never fabricated. */
/* global fmt */
/* exported fmtMetric, isIopvCurrent, createQuoteCandidate, pickBestQuote, weightedBuyPremium, tradeProfit, quoteNote */
function getBeijingNow(now = new Date()) {
  return new Date(now.getTime() + 480 * 60000);
}
function isChinaTradingTime(now = new Date()) {
  const bj = getBeijingNow(now);
  const day = bj.getUTCDay();
  const minutes = bj.getUTCHours() * 60 + bj.getUTCMinutes();
  return day !== 0 && day !== 6 &&
    ((minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900));
}
function toNum(v) {
  if (v === null || v === undefined || typeof v === 'boolean' || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function validPositive(v) { return Number.isFinite(v) && v > 0; }
function fmtMetric(v, digits = 3) { return validPositive(v) ? fmt(v, digits) : '--'; }
function getMarketDate(p, now = new Date()) {
  if (!p.isUsStock) return getBeijingNow(now).toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function getQuoteStamp(p, raw) {
  const stamp = String(raw.quoteTime || '');
  if (/^\d{14}$/.test(stamp)) {
    return `${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)} ${stamp.slice(8,10)}:${stamp.slice(10,12)}:${stamp.slice(12,14)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(stamp)) return stamp.slice(0,19);
  if (validPositive(toNum(raw.f86))) {
    const instant = new Date(Number(raw.f86) * 1000);
    if (p.isUsStock) {
      const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',
        year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(instant);
      const part = type => parts.find(value => value.type === type).value;
      return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
    }
    return getBeijingNow(instant).toISOString().slice(0,19).replace('T',' ');
  }
  return '';
}
function isIopvCurrent(p, iopv, quoteTime, now = new Date()) {
  if (p.isUsStock || !validPositive(iopv) || !quoteTime || quoteTime.slice(0,10) !== getMarketDate(p, now)) return false;
  const age = now.getTime() - Date.parse(quoteTime.replace(' ', 'T') + '+08:00');
  if (!Number.isFinite(age) || age < -120000) return false;
  if (isChinaTradingTime(now)) return age <= 180000;
  const bj = getBeijingNow(now), minutes = bj.getUTCHours() * 60 + bj.getUTCMinutes();
  const quoteMinutes = Number(quoteTime.slice(11,13)) * 60 + Number(quoteTime.slice(14,16));
  // Lunch retains the last intraday estimate; after 15:00 use a labelled closing IOPV.
  return minutes >= 690 && minutes < 780 && quoteMinutes >= 687 && quoteMinutes <= minutes + 2;
}
function createQuoteCandidate(p, raw, source, now = new Date()) {
  if (!raw) return null;
  const pre = toNum(raw.f60), actual = toNum(raw.f43);
  const open = toNum(raw.f46), high = toNum(raw.f44), low = toNum(raw.f45);
  const volume = toNum(raw.f47 ?? raw.volume), amount = toNum(raw.f48 ?? raw.amount);
  const quoteTime = getQuoteStamp(p, raw), quoteDate = quoteTime.slice(0,10);
  // Tencent updates its response timestamp during suspension; it is not a trade time.
  const suspended = !p.isUsStock && String(raw.status || '').trim().toUpperCase() === 'S' &&
    quoteDate === getMarketDate(p, now);
  const price = validPositive(actual) ? actual : pre;
  const noTrades = !validPositive(open) && !validPositive(high) && !validPositive(low) &&
    !validPositive(volume) && !validPositive(amount);
  const missingPrice = !validPositive(actual);
  let stale = suspended || missingPrice || source === 'kline_fallback';
  if (!p.isUsStock) {
    stale = stale || noTrades || !quoteTime || quoteDate !== getMarketDate(p, now);
    if (isChinaTradingTime(now) && quoteDate) {
      const age = now.getTime() - Date.parse(quoteTime.replace(' ', 'T') + '+08:00');
      stale = stale || quoteDate !== getMarketDate(p, now) || !Number.isFinite(age) || age > 180000 || age < -120000;
    }
  } else {
    // Allow weekends/one-day closures, but never label multi-day or undated prices as latest.
    const gap = (Date.parse(getMarketDate(p, now)) - Date.parse(quoteDate)) / 86400000;
    const latestAllowed = getQuoteStamp(p, {f86:(now.getTime() + 120000) / 1000});
    stale = stale || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(quoteTime) ||
      !Number.isFinite(gap) || gap < 0 || gap > 3 || quoteTime > latestAllowed;
  }
  const chg = validPositive(actual) && validPositive(pre) ? (actual / pre - 1) * 100 : null;
  const extPrice = toNum(raw.f71 ?? raw.extPrice);
  const extChg = validPositive(extPrice) && validPositive(price) ? (extPrice / price - 1) * 100 : null;
  return { f43: price, f60: pre, f46: open, f44: high, f45: low, f170: chg,
    f47: volume, f48: amount, extPrice, extChg, source, stale, suspended, noTrades, missingPrice, quoteTime,
    valid: validPositive(price), observedAt: now.getTime() };
}
function pickBestQuote(...candidates) {
  const usable = candidates.filter(c => c && c.valid);
  // Prefer the newest valid feed, not an older response merely because it is listed first.
  usable.sort((a,b) => Number(a.stale) - Number(b.stale) ||
    (b.quoteTime || '').localeCompare(a.quoteTime || ''));
  return usable[0] || null;
}
function weightedBuyPremium(trades) {
  const total = trades.reduce((sum, t) => sum + t.amt, 0);
  return total > 0 ? trades.reduce((sum, t) => sum + t.amt * t.prem, 0) / total : null;
}
function tradeProfit(trade, price) { return price * trade.vol - trade.amt; }
function quoteNote(p, d) {
  if (d.suspended) return '停牌中（腾讯状态 S） · 不可成交的参考报价' +
    (d.quoteTime ? ` · 接口响应 ${d.quoteTime} 北京时间（非成交时间）` : '');
  const time = d.quoteTime ? (d.quoteTime.length === 10 ? ` · ${d.quoteTime}（源仅提供日期）` :
    ` · ${d.quoteTime}${p.isUsStock ? ' 美东' : ' 北京时间'}`) : ' · 源时间未提供';
  if (d.stale) {
    const label = d.noTrades || d.missingPrice ? '昨收兜底 · 暂无有效成交' : '历史报价参考 · 行情待更新';
    return label + time;
  }
  return (p.isUsStock ? '美股最新报价' : (p.navIsCloseIopv ? '收盘报价（接口响应时间）' : '有效报价')) + time;
}

// Public helpers used by index.html's classic scripts.
Object.assign(window, { fmtMetric, isIopvCurrent, createQuoteCandidate, pickBestQuote, weightedBuyPremium, tradeProfit, quoteNote });
