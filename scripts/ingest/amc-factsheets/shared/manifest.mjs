import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {atomicJson} from './source-pool.mjs';
import {monthKey,monthLabel,targetMonth} from './dates.mjs';

// Findings describe source evidence; neither a new commit nor a successful build
// may turn an invalid or partial disclosure into a complete source check.
export function validationFindings(snapshot,month) {
  const findings=[];
  for(const bucket of [{asOfMonth:snapshot.asOfMonth,schemes:snapshot.schemes},...(snapshot.history||[])]) {
    if(monthKey(bucket.asOfMonth)!==month)continue;
    const names=new Set();
    for(const s of bucket.schemes||[]) {
      if(!s.schemeName||names.has(s.schemeName))findings.push('duplicate-or-missing-scheme');
      names.add(s.schemeName);
      if(monthKey(s.asOf)!==month)findings.push('date-mismatch');
      if(!Array.isArray(s.holdings)){findings.push('missing-holdings');continue;}
      const isins=new Set();
      for(const h of s.holdings) {
        if(!/^INE[A-Z0-9]{5}10[A-Z0-9]{2}$/.test(h.isin||''))continue;
        if(h.quantity<0||/[- ](?:\d{1,2}[- ]?)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[- ]*(?:20)?\d{2}\b|\b(?:futures?|options?|derivatives?)\b/i.test(h.name||''))continue;
        if(!Number.isSafeInteger(h.quantity)||h.quantity<0)findings.push('missing-quantity');
        if(isins.has(h.isin))findings.push('duplicate-isin');
        isins.add(h.isin);
        if(snapshot.amcSlug==='tata'&&/\^/.test(h.name||''))findings.push('unclassified-instrument');
      }
    }
  }
  return findings;
}

export function publishManifest(root,{interrupted=false,now=Date.now()}={}) {
  const dir=path.join(root,'public/amc-holdings'),index=JSON.parse(fs.readFileSync(path.join(dir,'index.json')));
  const checkFile=path.join(dir,'coverage-checks.json');
  const checks=fs.existsSync(checkFile)?JSON.parse(fs.readFileSync(checkFile)):[];
  const bySlug=new Map(checks.map(c=>[c.slug,c])),files=[],amcs=[],target=targetMonth(now);
  const generatedAt=new Date(now).toISOString();
  const directory=fs.existsSync(path.join(dir,'directory.json'))?JSON.parse(fs.readFileSync(path.join(dir,'directory.json'))):{status:'unavailable',reason:'directory-unchecked'};
  for(const entry of index.amcs) {
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug))throw Error('Invalid AMC identity');
    const file=entry.slug+'.json',location=path.join(dir,file);
    const bytes=fs.existsSync(location)?fs.readFileSync(location):null;
    const snapshot=bytes?JSON.parse(bytes):null;
    if(snapshot&&snapshot.amcSlug!==entry.slug)throw Error('Snapshot identity mismatch');
    const findings=snapshot?validationFindings(snapshot,target):[];
    const check={slug:entry.slug,name:entry.amc,month:monthKey(snapshot?.asOfMonth||entry.asOfMonth),status:'unchecked',checkedAt:null,...bySlug.get(entry.slug),validationFindings:findings.length};
    if((findings.length||directory.status!=='ok')&&check.status==='ok') {
      const priorComplete=check.priorCompleteCheckedAt||null;
      Object.assign(check,{status:'partial',partialCheckedAt:check.checkedAt,lastAttemptAt:check.lastAttemptAt||check.checkedAt,checkedAt:priorComplete,lastCompleteCheckedAt:priorComplete,reason:findings.length?'validation-findings':'directory-unavailable'});
    }
    if(!snapshot?.schemes?.length&&check.status==='ok')Object.assign(check,{status:'unavailable',checkedAt:check.priorCompleteCheckedAt||null,lastCompleteCheckedAt:check.priorCompleteCheckedAt||null,reason:'missing-snapshot'});
    delete check.priorCompleteCheckedAt;
    if(bytes)files.push({slug:entry.slug,file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    amcs.push(check);
    Object.assign(entry,{status:check.status,source:'amc-direct',asOfMonth:monthLabel(monthKey(snapshot?.asOfMonth)),fetchedMonth:monthLabel(check.month),schemes:snapshot?.schemes?.length||0,
      holdings:snapshot?.schemes?.reduce((n,s)=>n+(s.holdings?.length||0),0)||0,file:bytes?file:null,updatedAt:check.checkedAt,checkedAt:check.checkedAt,lastAttemptAt:check.lastAttemptAt||null,
      months:snapshot?1+(snapshot.history?.length||0):0});
  }
  const current=amcs.filter(c=>c.status==='ok'&&c.month===target);
  const manifest={schemaVersion:1,state:interrupted?'interrupted':'complete',generatedAt,targetMonth:target,
    checkedAt:amcs.map(c=>c.checkedAt||c.lastAttemptAt).filter(Boolean).sort()[0]||null,
    source:'Official AMC monthly portfolio disclosures',directory,amcs,files,
    coverage:{total:amcs.length,current:current.length,status:current.length===amcs.length&&!interrupted?'current':'partial'},
    retention:'All captured months retained; initial history varies by AMC. Missing or partial reports never establish a sale.'};
  index.meta={...index.meta,generatedAt,source:manifest.source,targetMonth:monthLabel(target),
    latestMonthByAmc:Object.fromEntries(index.amcs.map(e=>[e.slug,e.asOfMonth])),monthsByAmc:Object.fromEntries(index.amcs.map(e=>[e.slug,e.months])),
    behindTarget:amcs.filter(c=>c.month!==target).map(c=>({slug:c.slug,latest:monthLabel(c.month),status:c.status})),
    coverage:{total:amcs.length,ok:amcs.filter(c=>c.status==='ok').length,current:current.length,needsFallback:amcs.filter(c=>c.status!=='ok').map(c=>({slug:c.slug,status:c.status}))}};
  atomicJson(path.join(dir,'index.json'),index);
  atomicJson(checkFile,amcs);
  atomicJson(path.join(dir,'coverage.json'),manifest);
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(process.env.AMFIBEAS_PATH||fileURLToPath(new URL('../../../../',import.meta.url)));
  const m=publishManifest(root,{interrupted:process.env.AMC_CAPTURE_INTERRUPTED==='true'});
  console.log(`Published source manifest: ${m.coverage.current}/${m.coverage.total} current; ${m.files.length} retained snapshots`);
}
