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
for (const [code,nav12,nav13] of [['513390',2.1238,2.0974],['159655',1.8438,1.837],['159501',1.7778,1.7555]]) {
  assert.equal(navCache[code].date,'2026-11-13');
  assert.equal(navCache[code].nav,nav13);
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
assert.equal((html.match(/src="(?:quote-integrity|history-integrity|extended-quotes)\.js\?v=20261117-qqqm2"/g)||[]).length,3);
assert(!html.includes('price:684.000'));
assert(html.includes("code:'QQQM', secid:'105.QQQM'") && !html.includes("code:'QQQ',"));
assert(html.includes('--up:#ef4444') && html.includes('--down:#22c55e'));
console.log('PASS: inline syntax, suspension/resumption, feed validity, dated US extended quotes, cold-browser closes, published NAV, IOPV and holdings');
