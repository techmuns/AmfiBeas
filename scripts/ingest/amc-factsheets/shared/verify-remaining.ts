import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {parseAmcWorkbook,findSchemeName} from '../parse';
import type {AmcScheme} from '../types';
import {parsePublicWorkbook,publicDisclosures} from './public-disclosures.mjs';
import {parseQuantumWorkbook} from './quantum.mjs';
import {assertValidCandidate} from './manifest.mjs';
import {unifiMonth} from '../json-api';
const root=new URL('./fixtures/',import.meta.url),read=(file:string)=>fs.readFileSync(new URL(file,root));
const month='2026-09',opts={pctScale:1,valueToCr:100,strictHoldings:true};
const periodAbsent=(target:string,listed?:string)=>(e:unknown)=>e instanceof Error&&'code' in e&&e.code==='SOURCE_PERIOD_NOT_LISTED'&&'targetMonth' in e&&e.targetMonth===target&&(!listed||'listedMonths' in e&&Array.isArray(e.listedMonths)&&e.listedMonths.includes(listed));
const readBajaj=async(_url:string,options?:{body:string})=>{
  if(!options)return read('bajaj-monthly-section-2026-10-08.html');
  const form=new URLSearchParams(options.body);assert.equal(form.get('section_id'),'757');
  const action=form.get('action');
  if(action==='bajaj_get_downloads'){assert.equal(form.get('year'),'2026-27');assert.equal(form.get('month'),'September');return read('bajaj-monthly-files.json');}
  if(form.get('filter_for')==='months'){assert.equal(form.get('year'),'2026-27');return read('bajaj-monthly-months.json');}
  return read('bajaj-monthly-years.json');
};
async function verify() {
  const unifi=JSON.parse(read('unifi-media-2026-10-09.json').toString());
  const headers=read('unifi-media-2026-10-09.headers').toString();
  assert.equal(unifi.length,36);assert.match(headers,/X-WP-Total: 36/);assert.match(headers,/X-WP-TotalPages: 1/);
  const unifiPages:number[]=[];
  const files=unifiMonth(2026,9,page=>{unifiPages.push(page);assert.equal(page,1,'Do not request the documented out-of-range HTTP 400 page');return unifi;});
  assert.equal(files.length,3);assert.deepEqual(unifiPages,[1]);
  assert(files.every(f=>/-30092026\.xlsx$/i.test(f.url)),'Retain exact published September filenames');
  const full=Array.from({length:100},(_,i)=>({...unifi[i%unifi.length],source_url:unifi[i%unifi.length].source_url.replace('MP-Unifi-',`MP-Unifi-${i}-`)}));
  assert.equal(unifiMonth(2026,9,page=>page===1?full:unifi).length,full.filter(r=>/-\d{2}092026\.xlsx?$/i.test(r.source_url)).length+3);
  assert.throws(()=>unifiMonth(2026,9,()=>full),/Repeated/);
  assert.throws(()=>unifiMonth(2026,9,()=>({code:'rest_post_invalid_page_number',data:{status:400}})),/Invalid/);
  assert.throws(()=>unifiMonth(2026,9,page=>full.map(r=>({...r,source_url:r.source_url.replace('MP-Unifi-',`MP-Unifi-page${page}-`)}))),/Incomplete/);
  console.log('PASS genuine Unifi: complete 36-record WordPress catalogue, three September files, short-page termination, full-page continuation, repeated/malformed/over-limit rejection');
  const bajaj=await publicDisclosures('bajaj-finserv',month,readBajaj);assert.equal(bajaj.length,1);assert.match(bajaj[0].url,/30-Sep2026-1\.xls$/);
  const bytes=read('bajaj-monthly-2026-09.xls');assert.equal(bytes.subarray(0,2).toString(),'PK','Published .xls file contains OOXML; parse bytes instead of assuming legacy binary format');
  const parse=(buffer:Buffer,slug:string,link:unknown):AmcScheme[]=>parsePublicWorkbook(buffer,{XLSX,parseAmcWorkbook,parseVerifiedWorkbook:parseQuantumWorkbook,opts,month,slug,identifyScheme:findSchemeName,link});
  const schemes=parse(bytes,'bajaj-finserv',bajaj[0]);assert.equal(schemes.length,25);assert(schemes.every(s=>s.asOf==='2026-09-30'));assertValidCandidate('bajaj-finserv',schemes);
  const book=XLSX.read(bytes,{type:'buffer',cellNF:true});assert.equal(book.Sheets.BFARB.G7.v,0.0641);assert.match(book.Sheets.BFARB.G7.z||'',/%/);assert.equal(schemes.find(s=>s.schemeCode==='BFARB')?.holdings[0].pctToNav,6.41,'Keep the published percent format and precision');
  const wrong=await readBajaj('');await assert.rejects(publicDisclosures('bajaj-finserv',month,async()=>Buffer.from(wrong.toString().replace('>Monthly Portfolio<','>Fortnightly Portfolio<'))),/catalogue missing/);
  await assert.rejects(publicDisclosures('bajaj-finserv','2027-01',async(url:string,o?:{body:string})=>{if(o&&new URLSearchParams(o.body).get('filter_for')==='months')return Buffer.from(JSON.stringify({success:true,data:{options:[{value:'September',label:'September'}]}}));return readBajaj(url,o);}),periodAbsent('2027-01','2026-09'));
  console.log('PASS genuine Bajaj: new public AJAX catalogue, fiscal-year rollover, monthly category isolation, 25 September schemes, OOXML despite .xls suffix, and exact per-cell percentage units');

  const ilfs=await publicDisclosures('il-fs-idf',month,async()=>read('ilfs-catalogue-2026-10-08.html'));assert.equal(ilfs.length,1);assert.match(ilfs[0].url,/August_2026%20\(2\)\.xlsx$/);
  const raw=read('ilfs-monthly-2026-09.xlsx'),monthly=parse(raw,'il-fs-idf',ilfs[0]);assert.equal(monthly.length,3);assert(monthly.every(s=>s.asOf==='2026-09-30'));assert.equal(monthly.reduce((n,s)=>n+s.holdings.length,0),17);assertValidCandidate('il-fs-idf',monthly);
  const mixed=parseAmcWorkbook(raw,opts);assert.equal(mixed.length,6);assert.equal(mixed.filter(s=>s.asOf==='2026-09-15').length,3);
  const incomplete=XLSX.read(raw,{type:'buffer'});incomplete.SheetNames=incomplete.SheetNames.filter(n=>n!=='Portfolio 2C 30 Sep 2026');delete incomplete.Sheets['Portfolio 2C 30 Sep 2026'];assert.throws(()=>parse(XLSX.write(incomplete,{type:'buffer',bookType:'xlsx'}),'il-fs-idf',ilfs[0]));
  await assert.rejects(publicDisclosures('il-fs-idf',month,async()=>Buffer.from(read('ilfs-catalogue-2026-10-08.html').toString().replace('September -2026- Portfolio','August -2026- Portfolio'))),periodAbsent(month));
  console.log('PASS genuine IL&FS: misleading filename retains exact published URL, actual September 30 inventory, matched fortnightly identities, and missing month-end scheme rejection');

  for(const [slug,file] of [['360-one','360-catalogue-2026-10-08.html'],['zerodha','zerodha-catalogue-2026-10-08.html'],['quant','quant-month-selector-2026.json'],['alphagrep','alphagrep-catalogue-2026-10-08.json'],['dsp','dsp-monthly-catalogue-2026-10-08.html']] as const) {
    let calls=0;await assert.rejects(publicDisclosures(slug,month,async()=>{calls++;return read(file);}),periodAbsent(month,'2026-08'));assert.equal(calls,1,'A complete known catalogue without this month does not trigger guessed workbook requests');
  }
  assert.equal((await publicDisclosures('zerodha','2026-08',async()=>read('zerodha-catalogue-2026-10-08.html'))).length,22);
  const pages:number[]=[];await assert.rejects(publicDisclosures('the-wealth-company',month,async(url:string)=>{const p=Number(new URL(url).searchParams.get('page')||1);pages.push(p);return read(`wealth-monthly-page-${p}.html`);}),periodAbsent(month,'2026-08'));assert.deepEqual(pages,[1,2,3,4],'Inspect all 85 genuine monthly documents before concluding the target is absent from this catalogue');
  await assert.rejects(publicDisclosures('the-wealth-company',month,async()=>read('wealth-monthly-page-1.html')),/index changed/);
  await assert.rejects(publicDisclosures('lic',month,async(url:string)=>url.endsWith('-files')?read('lic-conflicting-catalogue-2026-09.html'):Buffer.from('<option value="639">Monthly Portfolio</option>')),e=>e instanceof Error&&'code' in e&&e.code==='SOURCE_INDEX_CONFLICT');
  console.log('PASS genuine remaining catalogues: exact target-period absence, 22 offered Zerodha August reports, complete 85-document Wealth pagination, repeated-page rejection and LIC label/file category conflict');
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
