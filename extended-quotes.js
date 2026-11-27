/* Tencent's timestamped extended-session quotes. Never infer them from regular quote fields. */
/* global fetchTencentQuotes, validPositive, getQuoteStamp, getMarketDate, getSessionCloseMinutes, isUsTradingDate */
function fetchUsExtended(items) {
  return Promise.all(items.filter(p => p.isUsStock).map(p => new Promise(resolve => {
    const key = 'etf_extended_' + p.code + '_' + Date.now();
    const script = document.createElement('script');
    let settled = false;
    p.extSnapshot = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const raw = window[key]?.data?.['us' + p.code]?.pandata;
        const price = Number(raw?.last);
        const time = String(raw?.time || '');
        if (validPositive(price) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time) &&
            ['before', 'after'].includes(raw?.tag)) {
          p.extSnapshot = {price, time, tag:raw.tag};
        }
      } catch (error) { console.warn('Extended quote unavailable:', p.code, error.message); }
      delete window[key];
      script.remove();
      resolve();
    };
    const timer = setTimeout(finish, 5000);
    script.onload = finish;
    script.onerror = finish;
    script.src = 'https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=us' +
      encodeURIComponent(p.code) + ',day,,,2,qfq&_var=' + key + '&_=' + Date.now();
    document.head.appendChild(script);
  })));
}
function fetchTencent(items, cb) {
  Promise.all([
    new Promise(resolve => fetchTencentQuotes(items, resolve)),
    fetchUsExtended(items)
  ]).then(([quotes]) => cb(quotes));
}
Object.assign(window, {fetchTencent});

// Validate extended quotes against their own session and the dated regular quote.
function getExtendedSnapshot(item, regular, now = new Date()) {
  const snapshot = item.extSnapshot;
  const validStamp = stamp => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp || '');
  if (!snapshot || regular.stale || !validPositive(regular.f43) || !validPositive(snapshot.price) ||
      !validStamp(regular.quoteTime) || !validStamp(snapshot.time)) return null;
  const date = snapshot.time.slice(0, 10), regularDate = regular.quoteTime.slice(0, 10);
  const latestAllowed = getQuoteStamp(item, {f86:(now.getTime() + 120000) / 1000});
  if (date > getMarketDate(item, now) || snapshot.time > latestAllowed || snapshot.time < regular.quoteTime) return null;
  const minutes = Number(snapshot.time.slice(11, 13)) * 60 + Number(snapshot.time.slice(14, 16));
  const closeMinutes = getSessionCloseMinutes(item, date);
  if (!isUsTradingDate(date)) return null;
  // Tencent's time is a response timestamp; UI explicitly distinguishes it from a trade print.
  if (snapshot.tag === 'after' && date === regularDate && minutes >= closeMinutes && minutes <= 1439) return snapshot;
  if (snapshot.tag === 'before' && date > regularDate && date === getMarketDate(item, now) &&
      minutes >= 240 && minutes < 570) return snapshot;
  return null;
}
Object.assign(window, {getExtendedSnapshot});
