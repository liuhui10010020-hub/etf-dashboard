/* Tencent's timestamped extended-session quotes. Never infer them from regular quote fields. */
/* global fetchTencentQuotes, validPositive */
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
