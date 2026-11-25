const fs = require('node:fs');
const vm = require('node:vm');
const nodeAssert = require('node:assert/strict');
let assertionCount = 0;
const assert = new Proxy(nodeAssert, {
  apply(target, receiver, args) { assertionCount++; return Reflect.apply(target, receiver, args); },
  get(target, key) {
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? (...args) => {
      assertionCount++; return Reflect.apply(value, target, args);
    } : value;
  }
});
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const storage = new Map();
const context = vm.createContext({console, Date, Intl, Map, Set, window:{},
  fmt:(n,d)=>Number(n).toFixed(d), setTimeout, clearTimeout,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  document:{getElementById:()=>null}});
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=/.test(match[1])) continue;
  new vm.Script(match[2]);
  if (match[2].includes('const STATIC_HIST_DATA') || match[2].includes('const patch =')) {
    vm.runInContext(match[2], context);
  }
}
context.getStaticHistory = item => vm.runInContext(`STATIC_HIST_DATA[${JSON.stringify(item.code)}] || []`, context);
for (const file of ['quote-integrity.js','history-integrity.js','extended-quotes.js']) {
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'), context);
}
const run = expression => vm.runInContext(expression, context);
run('var cn={code:"513390",isUsStock:false}; var us={code:"QQQM",isUsStock:true}; var now=new Date("2026-11-17T02:10:00Z"); var raw={f43:2.38,f60:2.38,f46:0,f44:0,f45:0,f47:0,status:"S",quoteTime:"20261117101000"}');
run('var stopped=createQuoteCandidate(cn,raw,"tencent",now)');
assert.equal(run('stopped.suspended'), true);
assert.equal(run('stopped.stale'), true);
assert.equal(run('stopped.noTrades'), true);
assert.equal(run('stopped.f43'), 2.38);
assert.match(run('quoteNote(cn,stopped)'), /停牌中.*接口响应.*非成交时间/);
assert.equal(run('isIopvCurrent(cn,2.0411,stopped.quoteTime,now)'), true);
assert.equal(((2.38/2.0411-1)*100).toFixed(2), '16.60');
assert.equal(run('recordCompletedClose(cn,stopped,new Date("2026-11-17T07:10:00Z"))'), false);
// Even a feed returning non-zero old OHLC must retain the confirmed suspension.
assert.equal(run('createQuoteCandidate(cn,{...raw,f46:2.39,f44:2.4,f45:2.37,f47:1000},"eastmoney",now).stale'), true);
run('var trading={...raw,status:"",f46:2.39,f44:2.4,f45:2.37,f47:1000}; var resumed=createQuoteCandidate(cn,trading,"tencent",now)');
assert.equal(run('resumed.suspended'), false);
assert.equal(run('resumed.stale'), false);
assert.equal(run('pickBestQuote(stopped,resumed).stale'), false);
assert.equal(run('createQuoteCandidate(cn,{...trading,quoteTime:"20261117100000"},"tencent",now).stale'), true);
assert.equal(run('createQuoteCandidate(cn,{...trading,quoteTime:"2026-11-17"},"tencent",now).stale'), true);
assert.match(run('quoteNote(cn,createQuoteCandidate(cn,{...trading,quoteTime:"2026-11-16"},"kline_fallback",now))'), /源仅提供日期/);
assert.equal(run('createQuoteCandidate(cn,{...trading,f43:0,f60:0},"tencent",now).valid'), false);
assert.equal(run('createQuoteCandidate(cn,{...trading,status:"S",quoteTime:"20261116151000"},"tencent",now).suspended'), false);
// US prices need a timestamp, no future time and a bounded completed-session age.
run('var usRaw={f43:661.75,f60:679.89,f46:671.04,f44:672.15,f45:660.48,f47:1000,quoteTime:"20261116160001"}; var regular=createQuoteCandidate(us,usRaw,"tencent",now)');
assert.equal(run('regular.stale'), false);
assert.equal(run('createQuoteCandidate(us,{...usRaw,quoteTime:"20261111160001"},"tencent",now).stale'), true);
assert.equal(run('createQuoteCandidate(us,{...usRaw,quoteTime:""},"tencent",now).stale'), true);
assert.equal(run('createQuoteCandidate(us,{...usRaw,quoteTime:"20261117160001"},"tencent",now).stale'), true);
run('us.extSnapshot={price:662.37,time:"2026-11-16 20:01:00",tag:"after"}');
assert.equal(run('getExtendedSnapshot(us,regular,now).price'), 662.37);
assert.equal(((662.37/661.75-1)*100).toFixed(2), '0.09');
run('us.extSnapshot={price:662.37,time:"2026-11-16 20:15:00",tag:"after"}');
assert.equal(run('getExtendedSnapshot(us,regular,now).price'), 662.37);
run('us.extSnapshot={price:662.37,time:"2026-11-16 15:59:00",tag:"after"}');
assert.equal(run('getExtendedSnapshot(us,regular,now)'), null);
run('us.extSnapshot={price:684,time:"2026-11-11 20:01:00",tag:"after"}');
assert.equal(run('getExtendedSnapshot(us,regular,now)'), null);
// Cold browser: all completed histories are present without any localStorage.
assert.equal(storage.size, 0);
for (const [code,price,count] of [['513390',2.38,209],['159655',1.97,209],['159501',2.07,209],['QQQM',272.49,220]]) {
  const rows = JSON.parse(run(`JSON.stringify(combineHistory({code:'${code}',isUsStock:${code==='QQQM'}},[],now))`));
  assert.equal(rows.length, count);
  assert.equal(rows.at(-1)[0], '2026-11-16');
  assert.equal(rows.at(-1)[1], price);
  assert.equal(new Set(rows.map(r=>r[0])).size, count);
  assert(rows.every(r=>r[1]>0 && r[0]<'2026-11-17'));
}
assert.equal(run('combineHistory(us,[],new Date("2026-11-16T19:59:00Z")).at(-1)[0]'), '2026-11-13');
const navCache = vm.runInContext('(' + html.match(/const PUBLISHED_NAV_CACHE = (\{[\s\S]*?\});/)[1] + ')', vm.createContext());
for (const [code,nav12,nav13,nav20,nav23] of [['513390',2.1238,2.0974,1.8789,2.0069],['159655',1.8438,1.837,1.6800,1.7569],['159501',1.7778,1.7555,1.5723,1.6796]]) {
  // Latest disclosure is 11/23; 11/20 stays available as an as-of reference date.
  assert.equal(navCache[code].date,'2026-11-23');
  assert.equal(navCache[code].nav,nav23);
  const rows = JSON.parse(run(`JSON.stringify(getStaticHistory({code:'${code}'}))`));
  for(const [date,nav] of [['2026-11-12',nav12],['2026-11-13',nav13]]) {
    const row=rows.find(r=>r[0]===date);
    assert(Math.abs(row[2]-(row[1]/nav-1)*100)<1e-9);
  }
  assert.equal(run(`isIopvCurrent({isUsStock:false},${nav13},"2026-11-13 15:00:00",now)`),false);
}
assert.equal(run('isIopvCurrent(cn,2.0411,"2026-11-17 09:30:00",now)'),false);
assert.equal(run('isIopvCurrent(cn,0,"2026-11-17 10:10:00",now)'),false);
assert.equal(run('isIopvCurrent(cn,1.8791,"2026-11-23 15:10:00",new Date("2026-11-23T07:12:00Z"))'),false);
assert.equal(run('isIopvCurrent(cn,1.8791,"2026-11-23 14:59:00",new Date("2026-11-23T06:59:30Z"))'),true);
assert.equal(run('readIopvArchive(us,now).length'),0);
// Verified close patrol persists today's closes and actual IOPV without browser storage.
run('var closeNow=new Date("2026-11-17T07:15:00Z")');
for (const [code,price,iopv] of [['513390',2.351,2.0411],['159655',1.937,1.8016],['159501',2.047,1.7085]]) {
  const rows = JSON.parse(run(`JSON.stringify(combineHistory({code:'${code}',isUsStock:false},[],closeNow))`));
  assert.equal(rows.at(-1)[0],'2026-11-17');
  assert.equal(rows.at(-1)[1],price);
  assert.equal(rows.length,210);
  assert.equal(new Set(rows.map(r=>r[0])).size,rows.length);
  const samples = JSON.parse(run(`JSON.stringify(readIopvArchive({code:'${code}'},closeNow))`));
  assert.equal(samples.at(-1)[0].slice(0,10),'2026-11-17');
  assert.equal(samples.at(-1)[1],price);
  assert.equal(samples.at(-1)[2],iopv);
  assert.equal(JSON.parse(run(`JSON.stringify(combineHistory({code:'${code}',isUsStock:false},[],now))`)).at(-1)[0],'2026-11-16');
}
assert.deepEqual([2.351/2.0411,1.937/1.8016,2.047/1.7085].map(r=>((r-1)*100).toFixed(2)),['15.18','7.52','19.81']);
assert.equal((2.351*202100+1.937*74500-650099).toFixed(0),'-30655');
assert.equal((2.38*202100+1.958*74500-650099).toFixed(0),'-23230');
assert.equal(run('weightedBuyPremium([{amt:150000,prem:9.81},{amt:49500,prem:9.97},{amt:100000,prem:10.47},{amt:100000,prem:9.38},{amt:100000,prem:9.59}]).toFixed(2)'), '9.83');
assert(html.includes('--（${unavailable}）'));
assert(html.includes('typeof getExtendedSnapshot'));
assert.equal((html.match(/src="(?:quote-integrity|history-integrity|extended-quotes)\.js\?v=20261125-open"/g)||[]).length,3);
assert(!html.includes('price:684.000'));
assert(html.includes("code:'QQQM', secid:'105.QQQM'") && !html.includes("code:'QQQ',"));
assert.equal(run('getStaticHistory({code:"QQQ"}).length'),0);
assert(!html.includes('HISTORY_QQQ'));
assert(!/\bQQQ\b/.test(html.slice(0,html.indexOf('<script>'))));
assert(html.includes('--up:#ef4444') && html.includes('--down:#22c55e'));
// November 19 cold start: completed closes and actual November 18 IOPV require no browser cache.
run('var morningNow=new Date("2026-11-19T02:10:00Z")');
for (const [code,price,count,iopv,nav16,nav17,nav18] of [
  ['513390',2.369,211,2.0261,2.0411,2.0261,2.0342],
  ['159655',1.941,211,1.7822,1.8015,1.7819,1.7779],
  ['159501',2.048,211,1.6959,1.7083,1.6958,1.7026],
  ['QQQM',271.58,222,null,null,null,null]
]) {
  const rows = JSON.parse(run(`JSON.stringify(combineHistory({code:'${code}',isUsStock:${code==='QQQM'}},[],morningNow))`));
  assert.equal(rows.length,count);
  assert.equal(rows.at(-1)[0],'2026-11-18');
  assert.equal(rows.at(-1)[1],price);
  assert.equal(new Set(rows.map(r=>r[0])).size,count);
  assert(!rows.some(r=>r[0]==='2026-11-19'));
  if (code==='QQQM') {
    assert.equal(rows.at(-2)[1],270.42);
    assert(rows.every(r=>r[2]===null));
    continue;
  }
  for (const [date,nav] of [['2026-11-16',nav16],['2026-11-17',nav17],['2026-11-18',nav18]]) {
    const row=rows.find(r=>r[0]===date);
    assert(Math.abs(row[2]-(row[1]/nav-1)*100)<1e-9);
  }
  const samples=JSON.parse(run(`JSON.stringify(readIopvArchive({code:'${code}'},morningNow))`));
  assert.equal(samples.at(-1)[0].slice(0,10),'2026-11-18');
  assert.equal(samples.at(-1)[1],price);
  assert.equal(samples.at(-1)[2],iopv);
  // Published NAV and IOPV are distinct feeds, not artificially forced to equal.
  assert.notEqual(navCache[code].nav,iopv);
}
assert.equal(storage.size,0);
// November 20 morning cold start should carry the verified November 19 A-share close and actual close IOPV.
run('var nextMorningNow=new Date("2026-11-20T02:10:00Z")');
for (const [code,price,count,iopv,nav18] of [
  ['513390',2.384,212,2.0343,2.0342],
  ['159655',1.941,212,1.7778,1.7779],
  ['159501',2.056,212,1.7026,1.7026]
]) {
  const rows = JSON.parse(run(`JSON.stringify(combineHistory({code:'${code}',isUsStock:false},[],nextMorningNow))`));
  assert.equal(rows.length,count);
  assert.equal(rows.at(-1)[0],'2026-11-19');
  assert.equal(rows.at(-1)[1],price);
  assert.equal(new Set(rows.map(r=>r[0])).size,count);
  const row = rows.find(r=>r[0]==='2026-11-19');
  assert(Math.abs(row[2]-(price/nav18-1)*100)<1e-9);
  const samples = JSON.parse(run(`JSON.stringify(readIopvArchive({code:'${code}'},nextMorningNow))`));
  assert.equal(samples.at(-1)[0].slice(0,10),'2026-11-19');
  assert.equal(samples.at(-1)[1],price);
  assert.equal(samples.at(-1)[2],iopv);
}
assert.equal(JSON.parse(run('JSON.stringify(combineHistory({code:"QQQM",isUsStock:true},[],nextMorningNow))')).at(-1)[0],'2026-11-19');
// November 23 morning: retain Friday closes and both dated 11/19 and 11/20 NAV references.
run('var mondayMorningNow=new Date("2026-11-23T02:10:00Z")');
for (const [code,price,count,nav19,nav20] of [
  ['513390',2.273,213,1.99,1.8789],
  ['159655',1.854,213,1.7421,1.6800],
  ['159501',1.966,213,1.6655,1.5723]
]) {
  const rows = JSON.parse(run(`JSON.stringify(combineHistory({code:'${code}',isUsStock:false},[],mondayMorningNow))`));
  assert.equal(rows.length,count);
  assert.equal(rows.at(-1)[0],'2026-11-20');
  assert.equal(rows.at(-1)[1],price);
  const withCache = JSON.parse(run(`JSON.stringify(buildHistoricalReferenceRows(combineHistory({code:'${code}',isUsStock:false},[],mondayMorningNow),[["2026-11-19",${nav19}],["2026-11-20",${nav20}]]))`));
  const row18 = withCache.find(r=>r[0]==='2026-11-18');
  assert.equal(row18[2],rows.find(r=>r[0]==='2026-11-18')[2]);
  const row19 = withCache.find(r=>r[0]==='2026-11-19');
  const row20 = withCache.find(r=>r[0]==='2026-11-20');
  assert(Math.abs(row19[2]-(row19[1]/nav19-1)*100)<1e-9);
  assert(Math.abs(row20[2]-(price/nav20-1)*100)<1e-9);
}
const qqqmMonday = JSON.parse(run('JSON.stringify(combineHistory(us,[],mondayMorningNow))'));
assert.equal(qqqmMonday.length,224);
assert.equal(qqqmMonday.at(-1)[0],'2026-11-20');
assert.equal(qqqmMonday.at(-1)[1],251.23);
assert.equal(qqqmMonday.at(-2)[1],265.64);
// November 20 close patrol: A-share completed closes and close IOPV samples should both advance to 11-20.
run('var closeNow2=new Date("2026-11-20T07:12:00Z")');
for (const [code,price,iopv,nav18] of [
  ['513390',2.273,2.0342,2.0342],
  ['159655',1.854,1.7779,1.7779],
  ['159501',1.966,1.7026,1.7026]
]) {
  const rows = JSON.parse(run(`JSON.stringify(combineHistory({code:'${code}',isUsStock:false},[],closeNow2))`));
  assert.equal(rows.at(-1)[0],'2026-11-20');
  assert.equal(rows.at(-1)[1],price);
  assert(Math.abs(rows.at(-1)[2]-(price/nav18-1)*100)<1e-9);
  const sample = JSON.parse(run(`JSON.stringify(getArchivedCloseIopv({code:'${code}'},'2026-11-20',closeNow2))`));
  assert.equal(sample[1],price);
  assert.equal(sample[2],iopv);
}
// Non-tradable reference prices must not be archived as a live IOPV premium.
const liveStamp = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date());
for (const flag of ['suspended','noTrades','missingPrice']) {
  run(`recordIopv({code:'159655',nav:1.7778,navIsLatest:true,navFallbackDate:'${liveStamp}'},{f43:1.944,quoteTime:'${liveStamp}',${flag}:true})`);
  assert.equal(storage.size,0);
}
run(`recordIopv({code:'159655',nav:1.6804,navIsLatest:false,navIsCloseIopv:true,navFallbackDate:'${liveStamp}'},{f43:1.845,quoteTime:'${liveStamp}'})`);
assert.equal(storage.has('etf-iopv-v1-159655'),true);
assert.equal(JSON.parse(storage.get('etf-iopv-v1-159655')).at(-1)[2],1.6804);
storage.clear();
assert.equal(run('recordCompletedClose(cn,{f43:2.369,quoteTime:"2026-11-19 15:10:00",suspended:true},new Date("2026-11-19T07:15:00Z"))'),false);
// Close patrol must survive a cold browser with all quote endpoints unavailable.
for (const [code, price, iopv] of [['513390',2.241,1.8791],['159655',1.845,1.6804],['159501',1.939,1.5724]]) {
  const atClose='new Date("2026-11-23T07:15:00Z")';
  const item=`{code:"${code}",isUsStock:false}`;
  const rows=JSON.parse(run(`JSON.stringify(combineHistory(${item},[],${atClose}))`));
  assert.equal(rows.at(-1)[0],'2026-11-23');
  assert.equal(rows.at(-1)[1],price);
  const observed=JSON.parse(run(`JSON.stringify(readIopvArchive(${item},${atClose}))`));
  assert.equal(observed.at(-1)[0].slice(0,10),'2026-11-23');
  assert.equal(observed.at(-1)[1],price);
  assert.equal(observed.at(-1)[2],iopv);
  assert.equal(run(`combineHistory(${item},[],new Date("2026-11-23T06:59:00Z")).some(r=>r[0]==="2026-11-23")`),false);
}
// November 24 cold start: today's verified closes and timestamped actual IOPV survive endpoint failure.
const patrol = [['513390',2.321,2.0074,'15:21:23'],['159655',1.898,1.7568,'15:21:30'],['159501',2.013,1.6796,'15:21:30']];
const atPatrol = 'new Date("2026-11-24T07:25:00Z")';
for (const [code,price,iopv,time] of patrol) {
  const item = `{code:"${code}",isUsStock:false}`;
  const rows = JSON.parse(run(`JSON.stringify(combineHistory(${item},[],${atPatrol}))`));
  assert.equal(rows.length,215);
  assert.deepEqual(rows.at(-1),['2026-11-24',price,null]);
  assert.equal(new Set(rows.map(r=>r[0])).size,rows.length);
  const sample = JSON.parse(run(`JSON.stringify(getArchivedCloseIopv(${item},"2026-11-24",${atPatrol}))`));
  assert.deepEqual(sample,[`2026-11-24 ${time}`,price,iopv]);
  assert.equal(run(`combineHistory(${item},[],new Date("2026-11-24T06:59:00Z")).at(-1)[0]`),'2026-11-23');
  // A later archive response must not appear before it was captured.
  assert.equal(run(`getArchivedCloseIopv(${item},"2026-11-24",new Date("2026-11-24T07:20:00Z"))`),null);
}
for (const instant of ['2026-11-23T22:00:00Z','2026-11-24T07:25:00Z']) {
  const rows = JSON.parse(run(`JSON.stringify(combineHistory(us,[],new Date("${instant}")))`));
  assert.equal(rows.length,225);
  assert.deepEqual(rows.at(-1),['2026-11-23',267.97,null]);
  assert.equal(rows.find(r=>r[0]==='2026-11-19')[1],265.64);
  assert.equal(rows.find(r=>r[0]==='2026-11-20')[1],251.23);
  assert(rows.every(r=>r[2]===null));
}
// 11/25 morning cold start: the completed 11/24 US regular session must be present without any cache.
const qqqmNov25 = JSON.parse(run('JSON.stringify(combineHistory(us,[],new Date("2026-11-25T02:10:00Z")))'));
assert.equal(qqqmNov25.length,226);
assert.deepEqual(qqqmNov25.at(-1),['2026-11-24',262.78,null]);
assert.equal(run('combineHistory(us,[],new Date("2026-11-25T02:10:00Z")).some(r=>r[0]==="2026-11-25")'),false);
// Polluted old cache and live rows cannot replace any verified static or latest close.
for (const [code,price] of patrol) {
  const item = `{code:"${code}",isUsStock:false}`;
  const baseline = JSON.parse(run(`JSON.stringify(combineHistory(${item},[],${atPatrol}))`));
  storage.set('etf-closes-v1-'+code,JSON.stringify(baseline.map(r=>[r[0],99,99])));
  const polluted = JSON.parse(run(`JSON.stringify(combineHistory(${item},[["2026-11-24",88,88],["2026-11-16",77,77]],${atPatrol}))`));
  assert.deepEqual(polluted,baseline);
  assert.equal(polluted.at(-1)[1],price);
  storage.clear();
}
storage.set('etf-closes-v1-QQQM',JSON.stringify([['2026-11-19',645.04],['2026-11-23',651.03]]));
assert.equal(run(`combineHistory(us,[["2026-11-23",651.03]],${atPatrol}).at(-1)[1]`),267.97);
storage.clear();
// Only missing dates can be filled by cache; a live sample may update an unverified date.
storage.set('etf-closes-v1-513390','[["2026-11-25",2.4]]');
assert.equal(run('combineHistory(cn,[["2026-11-25",2.5]],new Date("2026-11-25T07:25:00Z")).at(-1)[1]'),2.5);
assert.equal(run('combineHistory(cn,[],new Date("2026-11-25T07:25:00Z")).at(-1)[1]'),2.4);
storage.clear();
storage.set('etf-closes-v1-513390','{broken');
assert.equal(run(`combineHistory(cn,[],${atPatrol}).at(-1)[1]`),2.321);
storage.clear();
// Execute the actual fetchAll NAV-selection body (not a duplicate of the production rules).
const navStart = html.indexOf('const DATED_PUBLISHED_NAV_CACHE =');
const navEnd = html.indexOf('PORTFOLIO.forEach(p=>{',navStart);
vm.runInContext(html.slice(navStart,navEnd),context);
const selectionStart = html.indexOf('      const tx = txData[p.code];');
const selectionEnd = html.indexOf('      updateNavDisplay(p);',selectionStart);
assert(selectionStart>0 && selectionEnd>selectionStart);
vm.runInContext(`function selectNavForTest(p,txData) {${html.slice(selectionStart,selectionEnd)} return p; }`,context);
const RealDate = Date;
let fixedTime = Date.parse('2026-11-24T07:25:00Z');
context.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixedTime])); }
  static now() { return fixedTime; }
};
for (const [code,price,iopv,time] of patrol) {
  const item = `{code:"${code}",isUsStock:false}`;
  const raw = `{f43:${price},f60:${price},f46:${price},f44:${price},f45:${price},f47:1000,iopv:9,quoteTime:"2026-11-24 ${time}"}`;
  // No feed: correctly dated archive remains available, never labelled intraday/latest.
  const archived = JSON.parse(run(`JSON.stringify(selectNavForTest(${item},{}))`));
  assert.equal(archived.nav,iopv);
  assert.equal(archived.navIsCloseIopv,true);
  assert.equal(archived.navIsLatest,false);
  assert.equal(archived.navFallbackDate,`2026-11-24 ${time}`);
  // Suspended, no-trade and missing-price responses cannot supply a close IOPV, but a same-day IOPV
  // still gives the reference premium for the frozen (last-close) price.
  for (const invalid of ['status:"S"','f46:0,f44:0,f45:0,f47:0','f43:0']) {
    const result = JSON.parse(run(`JSON.stringify(selectNavForTest(${item},{"${code}":{...${raw},${invalid}}}))`));
    assert.equal(result.nav,9);
    assert.equal(result.navIsHaltIopv,true);
    assert.equal(result.navIsLatest,false);
    assert.equal(result.navIsCloseIopv,false);
    assert.equal(result.navFallbackDate,`2026-11-24 ${time}`);
  }
  // A previous-day response must fall back to the verified close IOPV archive instead.
  const previousDay = JSON.parse(run(`JSON.stringify(selectNavForTest(${item},{"${code}":{...${raw},quoteTime:"2026-11-23 15:21:30"}}))`));
  assert.equal(previousDay.nav,iopv);
  assert.equal(previousDay.navIsHaltIopv,false);
  assert.equal(previousDay.navIsLatest,false);
  assert.equal(previousDay.navFallbackDate,`2026-11-24 ${time}`);
  const valid = JSON.parse(run(`JSON.stringify(selectNavForTest(${item},{"${code}":{...${raw},iopv:${iopv}}}))`));
  assert.equal(valid.nav,iopv);
  assert.equal(valid.navIsCloseIopv,true);
  assert.equal(valid.navIsLatest,false);
  assert.match(run(`quoteNote(${item},createQuoteCandidate(${item},{...${raw},status:"S"},"tencent"))`),/不可成交的参考报价/);
}
// Intraday no-trade/suspension keeps the same-day live IOPV as the reference basis (price is the last close).
fixedTime = Date.parse('2026-11-24T02:10:00Z');
for (const [code,price,iopv] of patrol) {
  const item = `{code:"${code}",isUsStock:false}`;
  const raw = `{f43:${price},f60:${price},f46:${price},f44:${price},f45:${price},f47:1000,iopv:${iopv},quoteTime:"2026-11-24 10:10:00"}`;
  const valid = JSON.parse(run(`JSON.stringify(selectNavForTest(${item},{"${code}":${raw}}))`));
  assert.equal(valid.navIsLatest,true);
  assert.equal(valid.nav,iopv);
  for (const invalid of ['status:"S"','f46:0,f44:0,f45:0,f47:0','f43:0']) {
    const halted = JSON.parse(run(`JSON.stringify(selectNavForTest(${item},{"${code}":{...${raw},${invalid}}}))`));
    assert.equal(halted.navIsLatest,false);
    assert.equal(halted.navIsCloseIopv,false);
    // Otherwise the stale published NAV would overstate the premium by several points.
    assert.equal(halted.navIsHaltIopv,true);
    assert.equal(halted.nav,iopv);
    assert.equal(halted.navFallbackDate,'2026-11-24 10:10:00');
  }
  // A previous-day IOPV is never reused as today's halt reference.
  const staleIopv = JSON.parse(run(`JSON.stringify(selectNavForTest(${item},{"${code}":{...${raw},status:"S",quoteTime:"2026-11-23 15:21:30"}}))`));
  assert.equal(staleIopv.navIsHaltIopv,false);
  assert.equal(staleIopv.nav,navCache[code].nav);
}
// After the close a halted fund keeps the day's last IOPV; a missing one falls back to the dated NAV.
fixedTime = Date.parse('2026-11-25T07:25:00Z');
assert.equal(run('selectNavForTest(cn,{"513390":{...trading,status:"S",iopv:9,quoteTime:"2026-11-25 15:21:23"}}).nav'),9);
assert.equal(run('selectNavForTest(cn,{"513390":{...trading,status:"S",iopv:9,quoteTime:"2026-11-25 15:21:23"}}).navIsCloseIopv'),false);
assert.equal(run('selectNavForTest(cn,{"513390":{...trading,status:"S",iopv:9,quoteTime:"2026-11-25 15:21:23"}}).navIsHaltIopv'),true);
assert.equal(run('selectNavForTest(cn,{"513390":{...trading,status:"S",iopv:null,quoteTime:"2026-11-25 15:21:23"}}).nav'),2.0069);
context.Date = RealDate;
// A sparse NAV before a price date may be used; later NAVs must never leak backwards.
const sparse=JSON.parse(run('JSON.stringify(buildHistoricalReferenceRows([["2026-11-13",2,8],["2026-11-16",2.38,null],["2026-11-18",2.369,null]],[["2026-11-17",2.0261],["2026-11-15",2.0411]]))'));
assert.equal(sparse[0][2],8);
assert(Math.abs(sparse[1][2]-(2.38/2.0411-1)*100)<1e-9);
assert(Math.abs(sparse[2][2]-(2.369/2.0261-1)*100)<1e-9);
// A script that omits its NAV global cannot silently reuse another fund's data.
context.document.createElement=()=>({remove(){}});
context.document.head={appendChild:script=>script.onload()};
context.window.Data_netWorthTrend=[{x:Date.parse('2026-11-17T00:00:00+08:00'),y:99}];
run('loadOfficialNavHistory(cn)').then(async rows=>{
  assert.equal(rows.length,0);
  assert.equal(context.window.Data_netWorthTrend[0].y,99);
  context.renderStaticHistory=()=>{};
  let rendered;
  context.renderChart=(_item,priceRows)=>{rendered=priceRows;};
  for (const [code,nav19,nav20] of [['513390',1.99,1.8789],['159655',1.7421,1.6800],['159501',1.6655,1.5723]]) {
    await run(`loadHistoryAndRender({code:"${code}",isUsStock:false})`);
    const row19=rendered.find(r=>r[0]==='2026-11-19');
    const row20=rendered.find(r=>r[0]==='2026-11-20');
    assert(Math.abs(row19[2]-(row19[1]/nav19-1)*100)<1e-9);
    assert(Math.abs(row20[2]-(row20[1]/nav20-1)*100)<1e-9);
  }
  console.log(`PASS: ${assertionCount} assertions; syntax, QQQM anti-regression, cold-browser closes through 11/24, actual IOPV, polluted cache, suspension/no-trades, dated NAV/as-of premiums, isolated NAV feeds and holdings`);
}).catch(error=>{console.error(error);process.exitCode=1;});
