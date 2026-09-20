import assert from 'node:assert/strict';
import {publicDisclosures,publicReader,readDisclosures,verifiedNonIndianRows} from './public-disclosures.mjs';
import {sourceFailure} from './source-errors.mjs';
const month='2026-08',reply=v=>Buffer.from(JSON.stringify(v));
const next=value=>Buffer.from(`<script>self.__next_f.push(${JSON.stringify([1,'a:'+JSON.stringify(value)+'\n'])})</script>`);
const group={name:'Portfolio Holdings',slug:'/portfolio-holdings',download_category_level_2s:[{name:'Monthly',slug:'/monthly'}]};
const item=(id,date='31 August 2026')=>({id,name:`Monthly - Monarch Fund ${id} ${date}`,attachment:{url:`/uploads/fund-${id}.xls`}});
const reader=({duplicate=false,missing=false}={})=>async url=>{
  if(url.endsWith('/policies'))return next(group);
  const page=Number(new URL(url).searchParams.get('page')||1);
  return next({downloads:missing&&page===2?[]:[item(duplicate?1:page)],pagination:{page,pageCount:2,total:2}});
};
assert.equal((await publicDisclosures('monarch',month,reader())).length,2);
await assert.rejects(publicDisclosures('monarch',month,reader({duplicate:true})),/Repeated/);
await assert.rejects(publicDisclosures('monarch',month,reader({missing:true})),/Incomplete/);
await assert.rejects(publicDisclosures('monarch',month,async()=>next({...group,download_category_level_2s:[{name:'Fortnightly',slug:'/fortnightly'}]})),/unavailable/);
await assert.rejects(publicDisclosures('monarch','2026-07',reader()),/unavailable/);
const ask=Buffer.from('<h2>Portfolio Disclosures</h2><h3>Monthly</h3><li><p>ASK Liquid Fund Monthly Portfolio Disclosures 31082026</p><a href="./assests/monthly.xlsx">READ MORE</a></li><h3>Fortnightly</h3><li><p>ASK Liquid Fund Fortnightly Portfolio Disclosures 15082026</p><a href="./assests/fortnightly.xlsx">READ MORE</a></li><h2>Other</h2><li><p>Other Monthly Portfolio Disclosures 31082026</p><a href="./other.xlsx">Other</a></li>');
const askLinks=await publicDisclosures('ask',month,async()=>ask);
assert.deepEqual(askLinks,[{url:'https://www.askmutualfund.com/assests/monthly.xlsx',text:'ASK Liquid Fund'}]);
await assert.rejects(publicDisclosures('ask','2026-07',async()=>ask),/unavailable/);
const scheme={scheme_id:'A7381286-D615-4096-AF11-0DC02B64BD5B',scheme_name:'Lakshya Overnight Fund'};
const lakshya=await publicDisclosures('lakshya',month,async()=>reply([scheme]));
assert.equal(lakshya.length,1);assert.equal(new URL(lakshya[0].url).searchParams.get('reporting_month'),'8');
await assert.rejects(publicDisclosures('lakshya',month,async()=>reply([scheme,scheme])),/Invalid scheme/);
assert.deepEqual(sourceFailure(new SyntaxError('secret upstream body')),{kind:'invalid-catalogue'});
assert.deepEqual(sourceFailure(Error('token=private')),{kind:'validation-error'});
const denied=publicReader('ask',{execute:async()=>{throw Object.assign(Error('private transport internals'),{code:56,stdout:Buffer.from('\n403\n')});}});
await assert.rejects(denied('https://www.askmutualfund.com/x.xlsx'),e=>{
  assert.deepEqual(sourceFailure(e),{kind:'access-refused',httpStatus:403});return true;
});
const failed=await readDisclosures(askLinks,{month,read:async()=>{throw Object.assign(Error('Disclosure download failed'),{status:404});},parse:()=>[]});
assert.equal(failed.failedFiles,1);assert.deepEqual(failed.fileFailures[0].failure,{kind:'http-error',httpStatus:404});
console.log('PASS new AMC sources: published monthly labels, month-end dates, complete pagination, duplicate protection, missing reports and safe error evidence');

// Minimal rows from the previously rejected August 2026 JM Overnight workbook.
const overnight=[['JM Overnight Fund'],['Monthly Portfolio Statement for the period ended 31.08.2026'],
  ['ISIN','Name of Instrument','Rating/Industry','Quantity','Market Value (In Rs. lakh)','% To Net Assets'],
  [null,'DEBT INSTRUMENTS'],[null,'(d) Government Securities / SDL',null,null,'NIL','NIL'],
  [null,'TREPS / Reverse Repo Investments / Corporate Debt Repo'],
  [null,'CCIL',null,144545.181,14454.5181,0.9767976170958355],
  [null,'Cash & Cash Equivalents'],[null,'Net Receivable/Payable',null,null,343.3457021,0.023202382904164518],
  [null,'Grand Total',null,null,14797.8638021,1]];
assert(verifiedNonIndianRows(overnight,'JM Overnight Fund',month));
assert(!verifiedNonIndianRows(overnight,'JM Overnight Fund','2026-07'));
assert(!verifiedNonIndianRows(overnight.map(r=>r[1]==='CCIL'?['INE123A01016',...r.slice(1)]:r),'JM Overnight Fund',month));
assert(!verifiedNonIndianRows(overnight.map(r=>r[1]==='CCIL'?[null,'Unknown Company',...r.slice(2)]:r),'JM Overnight Fund',month));
assert(!verifiedNonIndianRows(overnight.map(r=>r[1]==='TREPS / Reverse Repo Investments / Corporate Debt Repo'?[null,'Equity & Equity related']:r),'JM Overnight Fund',month));
assert(!verifiedNonIndianRows(overnight.map(r=>r[0]?.includes('31.08.2026')?[r[0].replace('31.08.2026','15.08.2026')]:r),'JM Overnight Fund',month));
console.log('PASS JM Overnight regression: numeric month-end date, verified repo/cash rows, rejected unknown securities and fortnightly/stale dates');
