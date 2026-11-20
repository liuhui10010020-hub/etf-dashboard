const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
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
run('var cn={code:"513390",isUsStock:false}; var us={code:"QQQ",isUsStock:true}; var now=new Date("2026-11-17T02:10:00Z"); var raw={f43:2.38,f60:2.38,f46:0,f44:0,f45:0,f47:0,status:"S",quoteTime:"20261117101000"}');
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
for (const [code,price,count] of [['513390',2.38,209],['159655',1.97,209],['159501',2.07,209],['QQQ',661.75,220]]) {
  const rows = JSON.parse(run(`JSON.stringify(combineHistory({code:'${code}',isUsStock:${code==='QQQ'}},[],now))`));
  assert.equal(rows.length, count);
  assert.equal(rows.at(-1)[0], '2026-11-16');
  assert.equal(rows.at(-1)[1], price);
  assert.equal(new Set(rows.map(r=>r[0])).size, count);
  assert(rows.every(r=>r[1]>0 && r[0]<'2026-11-17'));
}
assert.equal(run('combineHistory(us,[],new Date("2026-11-16T19:59:00Z")).at(-1)[0]'), '2026-11-13');
const navCache = vm.runInContext('(' + html.match(/const PUBLISHED_NAV_CACHE = (\{[\s\S]*?\});/)[1] + ')', vm.createContext());
for (const [code,nav12,nav13,nav18] of [['513390',2.1238,2.0974,2.0342],['159655',1.8438,1.837,1.7779],['159501',1.7778,1.7555,1.7026]]) {
  assert.equal(navCache[code].date,'2026-11-18');
  assert.equal(navCache[code].nav,nav18);
  const rows = JSON.parse(run(`JSON.stringify(getStaticHistory({code:'${code}'}))`));
  for(const [date,nav] of [['2026-11-12',nav12],['2026-11-13',nav13]]) {
    const row=rows.find(r=>r[0]===date);
    assert(Math.abs(row[2]-(row[1]/nav-1)*100)<1e-9);
  }
  assert.equal(run(`isIopvCurrent({isUsStock:false},${nav13},"2026-11-13 15:00:00",now)`),false);
}
assert.equal(run('isIopvCurrent(cn,2.0411,"2026-11-17 09:30:00",now)'),false);
assert.equal(run('isIopvCurrent(cn,0,"2026-11-17 10:10:00",now)'),false);
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
assert.equal((html.match(/src="(?:quote-integrity|history-integrity|extended-quotes)\.js\?v=20261120-close2"/g)||[]).length,3);
assert(!html.includes('price:684.000'));
assert(html.includes("code:'QQQ', secid:'105.QQQ'") && !html.includes("code:'QQQM',"));
assert(html.includes('--up:#ef4444') && html.includes('--down:#22c55e'));
// November 19 cold start: completed closes and actual November 18 IOPV require no browser cache.
run('var morningNow=new Date("2026-11-19T02:10:00Z")');
for (const [code,price,count,iopv,nav16,nav17,nav18] of [
  ['513390',2.369,211,2.0261,2.0411,2.0261,2.0342],
  ['159655',1.941,211,1.7822,1.8015,1.7819,1.7779],
  ['159501',2.048,211,1.6959,1.7083,1.6958,1.7026],
  ['QQQ',659.51,222,null,null,null,null]
]) {
  const rows = JSON.parse(run(`JSON.stringify(combineHistory({code:'${code}',isUsStock:${code==='QQQ'}},[],morningNow))`));
  assert.equal(rows.length,count);
  assert.equal(rows.at(-1)[0],'2026-11-18');
  assert.equal(rows.at(-1)[1],price);
  assert.equal(new Set(rows.map(r=>r[0])).size,count);
  assert(!rows.some(r=>r[0]==='2026-11-19'));
  if (code==='QQQ') {
    assert.equal(rows.at(-2)[1],656.95);
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
  assert.equal(navCache[code].nav,nav18);
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
assert.equal(JSON.parse(run('JSON.stringify(combineHistory({code:"QQQ",isUsStock:true},[],nextMorningNow))')).at(-1)[0],'2026-11-19');
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
assert.equal(run('recordCompletedClose(cn,{f43:2.369,quoteTime:"2026-11-19 15:10:00",suspended:true},new Date("2026-11-19T07:15:00Z"))'),false);
// A sparse NAV before a price date may be used; later NAVs must never leak backwards.
const sparse=JSON.parse(run('JSON.stringify(buildHistoricalReferenceRows([["2026-11-13",2,8],["2026-11-16",2.38,null],["2026-11-18",2.369,null]],[["2026-11-17",2.0261],["2026-11-15",2.0411]]))'));
assert.equal(sparse[0][2],8);
assert(Math.abs(sparse[1][2]-(2.38/2.0411-1)*100)<1e-9);
assert(Math.abs(sparse[2][2]-(2.369/2.0261-1)*100)<1e-9);
// A script that omits its NAV global cannot silently reuse another fund's data.
context.document.createElement=()=>({remove(){}});
context.document.head={appendChild:script=>script.onload()};
context.window.Data_netWorthTrend=[{x:Date.parse('2026-11-17T00:00:00+08:00'),y:99}];
run('loadOfficialNavHistory(cn)').then(rows=>{
  assert.equal(rows.length,0);
  assert.equal(context.window.Data_netWorthTrend[0].y,99);
  console.log('PASS: syntax, suspension, quote validity, dated US quotes, cold-browser closes through 11/18, published NAV, as-of premiums, isolated NAV feeds, actual IOPV and holdings');
}).catch(error=>{console.error(error);process.exitCode=1;});
