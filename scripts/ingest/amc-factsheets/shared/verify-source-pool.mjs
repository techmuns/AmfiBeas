import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runSourcePool} from './source-pool.mjs';
import {quantumDisclosures,directPortfolioRows,parseQuantumWorkbook} from './quantum.mjs';
const quantumFile={FactSheetDate:'/Date(1788114600000)/',SchemeId:-1,FactSheetFreq:1,IsActive:1,FileUrl:'https://www.quantumamc.com/FileCDN/FactSheet/august-2026.xlsx'};
const quantumReply=(page,files,pages=1)=>({success:true,pageIndex:page,totalPageCount:pages,objProductPortfolioList:files});
const requested=[];
const quantumLinks=await quantumDisclosures('2026-08',async url=>{
  const q=new URL(url).searchParams;requested.push(Number(q.get('pageIndex')));
  assert.equal(q.get('yearId'),'2026');assert.equal(q.get('monthId'),'8');assert.equal(q.get('Frequency'),'1');
  return requested.length===1?quantumReply(1,[{...quantumFile,FactSheetDate:'/Date(1380499200000)/'},
    {...quantumFile,FactSheetFreq:2},{...quantumFile,SchemeId:4},{...quantumFile,IsActive:0},
    {...quantumFile,FileUrl:'https://example.test/report.xlsx'}],2):quantumReply(2,[quantumFile,quantumFile],2);
});
assert.deepEqual(requested,[1,2]);assert.deepEqual(quantumLinks,[quantumFile.FileUrl]);
await assert.rejects(quantumDisclosures('2026-08',async()=>quantumReply(1,[quantumFile],51)),/Incomplete/);
await assert.rejects(quantumDisclosures('2026-08',async()=>quantumReply(1,[],1)),/unavailable/);
await assert.rejects(quantumDisclosures('2026-08',async url=>quantumReply(Number(new URL(url).searchParams.get('pageIndex')),[],2)),/unavailable/);
await assert.rejects(quantumDisclosures('2026-08',async url=>quantumReply(Number(new URL(url).searchParams.get('pageIndex')),[],Number(new URL(url).searchParams.get('pageIndex'))===1?2:1)),/changed/);
const ownRows=[['Quantum Diversified Equity All Cap Active FOF'],['Fund units','INF209K01WE3',1347101]];
const appendix=[['Monthly Portfolio Statement of the Underlying Schemes of Quantum Diversified Equity All Cap Active FOF'],['Underlying company','INE090A01021',10000000]];
assert.deepEqual(directPortfolioRows([...ownRows,...appendix]),ownRows);
assert.deepEqual(directPortfolioRows(ownRows),ownRows);
assert.deepEqual(directPortfolioRows([['Company equity','INE090A01021',150]]),[['Company equity','INE090A01021',150]],'Real directly held equity remains intact');
// Exercise the workbook adapter with injected I/O; the source runtime supplies XLSX.
const fakeXlsx={read:()=>({SheetNames:['FoF','Equity'],Sheets:{FoF:[...ownRows,...appendix],Equity:[['Direct equity','INE090A01021',150]]}}),utils:{sheet_to_json:s=>s,aoa_to_sheet:r=>r},write:book=>book.Sheets};
const parseFixture=book=>{assert.deepEqual(book.FoF,ownRows);assert.equal(book.Equity[0][2],150);return[{asOf:'2026-08-31',holdings:[]}];};
assert.equal(parseQuantumWorkbook(null,{XLSX:fakeXlsx,parseAmcWorkbook:parseFixture,opts:{},month:'2026-08'}).length,1);
assert.throws(()=>parseQuantumWorkbook(null,{XLSX:fakeXlsx,parseAmcWorkbook:()=>[{asOf:'2013-09-30'}],opts:{},month:'2026-08'}),/month unverified/);
assert.throws(()=>parseQuantumWorkbook(null,{XLSX:fakeXlsx,parseAmcWorkbook:()=>[{asOf:'2026-08-31',schemeName:'Quantum Equity FOF',holdings:[{isin:'INE090A01021'}]}],opts:{},month:'2026-08'}),/Ambiguous FoF/);
const original=Buffer.from('original workbook'),withoutAppendix={...fakeXlsx,read:()=>({SheetNames:['Equity'],Sheets:{Equity:[['Direct equity','INE090A01021',150]]}}),write:()=>{throw Error('Unnecessary workbook rewrite');}};
parseQuantumWorkbook(original,{XLSX:withoutAppendix,parseAmcWorkbook:buffer=>{assert.equal(buffer,original);return[{asOf:'2026-08-31',schemeName:'Equity Fund',holdings:[]}];},opts:{},month:'2026-08'});
console.log('PASS Quantum disclosures: exact month, complete pagination, permitted files, actual workbook dates and direct ownership without underlying-fund double counting');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mf-source-pool-test-'));
try {
  const script=path.join(dir,'source.mjs'),events=path.join(dir,'events'),checksFile=path.join(dir,'checks.json');
  fs.writeFileSync(script,`import fs from 'node:fs';import{spawn}from'node:child_process';
const slug=process.env.MF_SOURCE_AMCS;
fs.appendFileSync(process.env.EVENTS,JSON.stringify({slug,event:'start'})+'\\n');
if(slug==='seeded'){const prior=JSON.parse(process.env.MF_SOURCE_PREVIOUS_CHECK);if(prior?.resumeUrl!=='pending.xlsx')process.exit(3);}
if(slug==='failed')process.exit(2);
if(slug==='hanging'||slug==='checkpointed'||slug==='checkpoint-empty'){
  if(slug!=='hanging')fs.writeFileSync(process.env.MF_SOURCE_CHECK_FILE,JSON.stringify([{slug,status:'partial',schemeCount:slug==='checkpoint-empty'?0:2,resumeUrl:'pending.xlsx',checkedAt:null,partialCheckedAt:'2026-09-20T09:00:00Z',month:'2026-08',expectedFiles:3,completedFiles:2,pendingFiles:1}]));
  const descendant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
  fs.writeFileSync(process.env.DESCENDANT,String(descendant.pid));
  process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
}else setTimeout(()=>{
  fs.writeFileSync(process.env.MF_SOURCE_CHECK_FILE,JSON.stringify([{slug,status:'ok',checkedAt:'2026-09-20T09:00:00Z',month:'2026-08'}]));
  fs.appendFileSync(process.env.EVENTS,JSON.stringify({slug,event:'done'})+'\\n');
},20);`);
  const descendant=path.join(dir,'descendant'),env={...process.env,EVENTS:events,DESCENDANT:descendant};
  const entries=['hanging','fast','later','failed'].map(slug=>({slug,amc:slug}));
  const completed=[];
  const result=await runSourcePool(entries,{command:process.execPath,args:[script],env,checksFile,concurrency:2,timeoutMs:1000,
    initial:[{slug:'untouched',status:'ok',checkedAt:'original-source-time'}],onResult:c=>completed.push(c.slug)});
  assert(!result.interrupted);
  assert(completed.indexOf('fast')<completed.indexOf('hanging'),'A stalled first source cannot block a later source');
  const bySlug=new Map(result.checks.map(c=>[c.slug,c]));
  assert.equal(bySlug.get('hanging').reason,'source-timeout');assert.equal(bySlug.get('hanging').checkedAt,null);
  assert.equal(bySlug.get('failed').reason,'source-process-failed');assert.equal(bySlug.get('later').status,'ok');
  assert.equal(bySlug.get('untouched').checkedAt,'original-source-time');
  assert.deepEqual(JSON.parse(fs.readFileSync(checksFile)),result.checks,'Every completion is durably checkpointed');
  const eventsRead=fs.readFileSync(events,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert(eventsRead.findIndex(e=>e.slug==='later'&&e.event==='start')>eventsRead.findIndex(e=>e.slug==='fast'&&e.event==='done'),'No third source starts before a slot is free');
  // An exited descendant can briefly remain as a zombie until init reaps it; neither
  // a missing process nor a zombie can continue making source requests.
  const pid=Number(fs.readFileSync(descendant));
  await new Promise(done=>setTimeout(done,50));
  try {process.kill(pid,0);const {execFileSync}=await import('node:child_process');assert.match(execFileSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'}),/^\s*Z/);}catch(error){if(error.code!=='ESRCH'&&error.status!==1)throw error;}

  const cancel=new AbortController();cancel.abort();
  const interrupted=await runSourcePool([{slug:'not-started',amc:'Not started'}],{command:process.execPath,args:[script],env,checksFile,signal:cancel.signal,initial:[{slug:'not-started',month:'2026-08',schemeCount:98,resumeUrl:'pending.xlsx'}]});
  assert(interrupted.interrupted);assert.equal(interrupted.checks[0].status,'unchecked');
  assert.equal(interrupted.checks[0].month,'2026-08');assert.equal(interrupted.checks[0].schemeCount,98);assert.equal(interrupted.checks[0].resumeUrl,'pending.xlsx');
  const seeded=await runSourcePool([{slug:'seeded',amc:'Seeded'}],{command:process.execPath,args:[script],env,checksFile,initial:[{slug:'seeded',resumeUrl:'pending.xlsx'}]});
  assert.equal(seeded.checks[0].status,'ok','A fresh source child receives the previously published continuation point');
  assert.equal(fs.existsSync(`${checksFile}.tmp`),false);
  const activeCancel=new AbortController();
  const active=runSourcePool([{slug:'hanging',amc:'Hanging'},{slug:'queued',amc:'Queued'}],{command:process.execPath,args:[script],env,checksFile,concurrency:1,timeoutMs:10000,signal:activeCancel.signal});
  setTimeout(()=>activeCancel.abort(),300);
  const stopped=await active;
  assert(stopped.interrupted);assert.equal(stopped.checks.find(c=>c.slug==='hanging').reason,'interrupted');
  assert.equal(stopped.checks.find(c=>c.slug==='queued').status,'unchecked','Cancellation cannot start another source');
  const saved=await runSourcePool([{slug:'checkpointed',amc:'Checkpointed'}],{command:process.execPath,args:[script],env,checksFile,timeoutMs:1000});
  assert.equal(saved.checks[0].status,'partial');assert.equal(saved.checks[0].schemeCount,2);
  assert.equal(saved.checks[0].checkedAt,null);assert.equal(saved.checks[0].partialCheckedAt,'2026-09-20T09:00:00Z');assert.equal(saved.checks[0].reason,'source-timeout');
  assert.equal(saved.checks[0].pendingFiles,1,'A timed-out file retains completed reports without claiming a full check');
  const emptyProgress=await runSourcePool([{slug:'checkpoint-empty',amc:'No parsed reports yet'}],{command:process.execPath,args:[script],env,checksFile,timeoutMs:1000});
  assert.equal(emptyProgress.checks[0].schemeCount,0);assert.equal(emptyProgress.checks[0].resumeUrl,'pending.xlsx','Timeout preserves the next file even if earlier downloads all failed');
  // Exercise the actual source entry point with local adapters. Missing public
  // Axis client config fails discovery before any network request or file parse.
  const fixture=path.join(dir,'source-fixture'),adapters=path.join(fixture,'scripts/ingest/amc-factsheets'),holdings=path.join(fixture,'public/amc-holdings');
  fs.mkdirSync(adapters,{recursive:true});fs.mkdirSync(holdings,{recursive:true});
  const modules={'fetch.ts':'export const fetchLatest=()=>null;', 'parse.ts':'export const parseAmcWorkbook=()=>[];', 'advisorkhoj.ts':'export const parseZip=()=>[],normalizeSchemePct=s=>s;', 'page-scrape.ts':'export const PAGE_SCRAPE_CONFIG={},pageScrapeAmc=()=>null,downloadAndParse=()=>null;', 'json-api.ts':'export const JSON_API_CONFIG={},jsonApiAmc=()=>null;'};
  for(const [name,body] of Object.entries(modules))fs.writeFileSync(path.join(adapters,name),body);
  fs.writeFileSync(path.join(holdings,'index.json'),JSON.stringify({amcs:[{slug:'axis',amc:'Axis',asOfMonth:'2026-06'}]}));
  fs.writeFileSync(path.join(holdings,'axis.json'),JSON.stringify({asOfMonth:'2026-07',schemes:[]}));
  const {execFileSync}=await import('node:child_process');
  execFileSync(process.execPath,[path.resolve('scripts/ingest/amc-factsheets/shared/run.mjs')],{env:{...process.env,AMFIBEAS_PATH:fixture,MF_SOURCE_WORKER:'1',MF_SOURCE_AMCS:'axis',MF_SOURCE_CHECK_FILE:path.join(holdings,'checks.json'),MF_SOURCE_PREVIOUS_CHECK:JSON.stringify({slug:'axis',month:'2026-08',schemeCount:81,status:'ok',checkedAt:'2026-09-20T09:00:00Z',resumeUrl:'pending.xlsx'})},stdio:'pipe',timeout:10000});
  const discoveryFailure=JSON.parse(fs.readFileSync(path.join(holdings,'checks.json')))[0];
  assert.equal(discoveryFailure.status,'unavailable');assert.equal(discoveryFailure.month,'2026-08');assert.equal(discoveryFailure.schemeCount,81);assert.equal(discoveryFailure.resumeUrl,'pending.xlsx');assert.equal(discoveryFailure.checkedAt,'2026-09-20T09:00:00Z');
  // Match scheduled Actions' blank optional AMC_ONLY input. The actual entry
  // point must attempt the listed source instead of silently selecting no AMCs.
  for(const value of ['', ' ,  ']) {
    const output=path.join(holdings,'blank-selection.json');
    fs.rmSync(output,{force:true});
    execFileSync(process.execPath,[path.resolve('scripts/ingest/amc-factsheets/shared/run.mjs')],{env:{...process.env,AMFIBEAS_PATH:fixture,MF_SOURCE_WORKER:'1',MF_SOURCE_AMCS:'',AMC_ONLY:value,MF_SOURCE_CHECK_FILE:output,MF_SOURCE_PREVIOUS_CHECK:'null'},stdio:'pipe',timeout:10000});
    const attempted=JSON.parse(fs.readFileSync(output));
    assert.equal(attempted.length,1,'Blank filters must attempt every indexed source');
    assert.equal(attempted[0].slug,'axis');assert.equal(attempted[0].reason,'source-discovery-failed');
    assert(attempted[0].lastAttemptAt);
  }
  console.log('PASS source isolation: bounded concurrency, hung source and descendant timeout, later-source progress, failed child, durable checkpoints, preserved check times and interruption');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
