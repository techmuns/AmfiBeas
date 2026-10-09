import * as XLSX from 'xlsx';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {parseAmcWorkbook,findSchemeName} from '../parse';
import {normalizeSchemePct,parseZip} from '../advisorkhoj';
import {capitalmindMonthlyRows,jmDisclosurePeriod} from '../json-api';
import {statutoryLinks} from './discovery.mjs';
import {isMonthEnd} from './dates.mjs';
import {publicDisclosures} from './public-disclosures.mjs';
import {parseQuantumWorkbook} from './quantum.mjs';
const root=new URL('./fixtures/',import.meta.url);
const evidence=JSON.parse(fs.readFileSync(new URL('provenance.json',root),'utf8'));
for(const source of evidence.sources)assert.equal(createHash('sha256').update(fs.readFileSync(new URL(source.file,root))).digest('hex'),source.sha256);
const [angel]=parseAmcWorkbook(fs.readFileSync(new URL('angel-nifty50-2026-09.xlsx',root)),{pctScale:1,valueToCr:100,strictHoldings:true});
assert.equal(angel.asOf,'2026-09-30');assert.equal(angel.schemeName,'Angel One Nifty 50 Index Fund');
assert.equal(angel.holdings.find(h=>h.isin==='INE040A01034')?.pctToNav,10.3742);
assert.equal(normalizeSchemePct(angel).holdings.find(h=>h.isin==='INE040A01034')?.pctToNav,10.3742,'Explicit Excel percentage units normalize once, before rounding');
const abakkus=statutoryLinks('abakkus',fs.readFileSync(new URL('abakkus-catalogue-2026-10-08.html',root),'utf8'),'2026-09');
assert.equal(abakkus.length,1);assert.match(abakkus[0].url,/Sep30_2026/);
const cm=capitalmindMonthlyRows(fs.readFileSync(new URL('capitalmind-catalogue-2026-10-08.html',root),'utf8'));
assert.equal(cm.get('2026-09')?.length,4);assert(![...cm.values()].flat().some(l=>/Overlap|Fortnight|Half/i.test(l.url)));
assert.equal(jmDisclosurePeriod('Monthly Portfolio - JM Value Fund - September 30, 2026'),'2026-09');
assert.equal(jmDisclosurePeriod('Monthly Portfolio - JM Value Fund - September 15, 2026'),null);
assert(isMonthEnd('2026-09-30','2026-09'));assert(!isMonthEnd('2026-09-15','2026-09'));assert(!isMonthEnd('2026-08-31','2026-09'));
console.log('PASS genuine September fixtures: workbook date, percentage precision, hydrated catalogue JSON, overlap rejection and reporting period independent of upload time');

import {verifiedNonIndianRows,parsePublicWorkbook} from './public-disclosures.mjs';
import {assertValidCandidate} from './manifest.mjs';
for(const [file,name] of [['jm-overnight-september.xlsx','JM Overnight Fund'],['angel-liquid-september.xlsx','AngelOne Nifty 1D Rate Liquid ETF GROWTH']]) {
  const buffer=fs.readFileSync(new URL(file,root)),book=XLSX.read(buffer,{type:'buffer'});
  const rows=XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]],{header:1,blankrows:false,defval:null});
  assert(verifiedNonIndianRows(rows,name,'2026-09'));assert(!verifiedNonIndianRows(rows,name,'2026-08'));
  const forged=rows.map(r=>r.map(v=>typeof v==='string'?v.replace('The Clearing Corporation of India Ltd. 01-OCT-2026','Unknown security'):v));
  assert(!verifiedNonIndianRows(forged,name,'2026-09'));
  const scheme=parsePublicWorkbook(buffer,{XLSX,parseAmcWorkbook,parseVerifiedWorkbook:()=>{throw Error('Empty verification required');},opts:{pctScale:1,valueToCr:100,strictHoldings:true},month:'2026-09',slug:'fixture',identifyScheme:findSchemeName,link:{text:name,url:'https://example.test/monthly.xlsx'}})[0];
  assert.equal(scheme.asOf,'2026-09-30');assert.equal(scheme.validatedNoIndianHoldings,true);assertValidCandidate('fixture',[scheme]);
}
assert.throws(()=>assertValidCandidate('fixture',[{...angel,asOf:'2026-09-15'}]),/unverified/);
assert.throws(()=>assertValidCandidate('fixture',[{...angel,holdings:[]}]),/unverified/);
assert.throws(()=>assertValidCandidate('fixture',[{...angel,holdings:[angel.holdings[0],angel.holdings[0]]}]),/unverified/);
console.log('PASS genuine September repo workbooks: exact reporting period, bounded known non-equity rows, unknown-security rejection and validation before retained-data replacement');

assert.equal(jmDisclosurePeriod('Monthly  Portfolio- JM Overnight Fund -   Sep 30,2026'),'2026-09');

assert.equal(jmDisclosurePeriod('Monthly Portfolio - JM Arbitrage Fund  Sep 30, 2026'),'2026-09');

for(const [file,slug,count] of [['absl-september.zip','absl',93],['uti-september.zip','uti',84]] as const) {
  const schemes=parseZip(fs.readFileSync(new URL(file,root)),{pctScale:1,valueToCr:100,strictHoldings:true});
  assert.equal(schemes.length,count);assert(schemes.every(s=>s.asOf==='2026-09-30'));assertValidCandidate(slug,schemes);
}
console.log('PASS genuine ABSL/UTI archives: mixed Excel formats and actual reporting headings, every parsed scheme dated to month-end');

async function verifyHdfc() {
  const hdfc=await publicDisclosures('hdfc','2026-09',async()=>fs.readFileSync(new URL('hdfc-catalogue-2026-10-08.html',root)));
  assert.equal(hdfc.length,110);
  const largeMid=hdfc.find(link=>link.text==='HDFC Large Mid Cap Fund');
  assert(largeMid);assert.match(largeMid.url,/Large%20%20Mid/);assert.match(largeMid.url,/VersionId=/);
  console.log('PASS genuine HDFC catalogue: all 110 September monthly links, normalized display whitespace, unchanged versioned download URLs');
  const monarch=await publicDisclosures('monarch','2026-09',async (url:string)=>fs.readFileSync(new URL(url.endsWith('/policies')?'monarch-catalogue-2026-10-08.html':'monarch-monthly-2026-10-08.html',root)));
  assert.equal(monarch.length,1);assert.equal(monarch[0].text,'Monarch Overnight Fund');
  const buffer=fs.readFileSync(new URL('monarch-overnight-2026-09.xls',root)),opts={pctScale:1,valueToCr:100,strictHoldings:true};
  const parseMonarch=(bytes:Buffer)=>parsePublicWorkbook(bytes,{XLSX,parseAmcWorkbook,parseVerifiedWorkbook:parseQuantumWorkbook,opts,month:'2026-09',slug:'monarch',identifyScheme:findSchemeName,link:monarch[0]});
  const [scheme]=parseMonarch(buffer);assert.equal(scheme.asOf,'2026-09-30');assert.equal(scheme.schemeName,'Monarch Overnight Fund');assert(scheme.validatedNoIndianHoldings);assertValidCandidate('monarch',[scheme]);
  const book=XLSX.read(buffer,{type:'buffer'}),rows=XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.MNOVNFD,{header:1,blankrows:false,defval:null});
  assert(verifiedNonIndianRows(rows,scheme.schemeName,'2026-09'));
  assert(!verifiedNonIndianRows(rows.map(r=>r.map(v=>v==='5.30% Reverse Repo'?'Unknown instrument':v)),scheme.schemeName,'2026-09'));
  const quantity=rows.find(r=>r.some(v=>v==='ISIN'))!.findIndex(v=>v==='Quantity');
  assert(!verifiedNonIndianRows(rows.map(r=>r.includes('1609260100')?r.map((v,i)=>i===quantity?100:v):r),scheme.schemeName,'2026-09'));
  const index=XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Index,{header:1,blankrows:false,defval:null});index.push(['INE040A01034','Hidden holding',100]);book.Sheets.Index=XLSX.utils.aoa_to_sheet(index);
  assert.throws(()=>parseMonarch(XLSX.write(book,{type:'buffer',bookType:'xlsx'})),/unverified/);
  console.log('PASS genuine Monarch disclosure: new monthly category, exact scheme index/heading, dated repo-only inventory, rejected unknown contracts, share quantities and hidden index holdings');
}
verifyHdfc().catch(error=>{console.error(error);process.exitCode=1;});
