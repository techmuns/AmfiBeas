import assert from 'node:assert/strict';
import {publicDisclosures} from './public-disclosures.mjs';
const month='2026-08',json=value=>Buffer.from(JSON.stringify(value)),html=value=>Buffer.from(value);
const canaraBase='https://www.canararobeco.com/documents/statutory-disclosures/scheme-dashboard/scheme-monthly-portfolio/';
const canaraPage=(p,{duplicate=false,wrongMonth=false}={})=>html(`<a href="/uploads/${duplicate?1:p}.xlsx">Canara Fund ${p} – ${wrongMonth?'July':'August'} 2026</a><a href="${canaraBase}?filteryear=2026&amp;filtermonth=08&amp;pagination=2">2</a>`);
const pages=[];
assert.equal((await publicDisclosures('canara-robeco',month,async url=>{const p=Number(new URL(url).searchParams.get('pagination')||1);pages.push(p);return canaraPage(p);})).length,2);
assert.deepEqual(pages,[1,2]);
await assert.rejects(publicDisclosures('canara-robeco',month,async url=>canaraPage(Number(new URL(url).searchParams.get('pagination')||1),{duplicate:true})),/Repeated/);
await assert.rejects(publicDisclosures('canara-robeco',month,async()=>canaraPage(1,{wrongMonth:true})),/month mismatch/);
await assert.rejects(publicDisclosures('canara-robeco',month,async url=>new URL(url).searchParams.has('pagination')?html(''):canaraPage(1)),/Incomplete/);
const jioFile={title:'JioBlackRock Equity Fund-Monthly-Portfolio-31-08-2026',docType:'file',file:{url:'https://jioinvest.cdn.jio.com/fund.xlsx'}};
const jioReader=({total=1,date='31-08-2026'}={})=>async(url,options)=>{
  if(options){assert.equal(options.headers['next-action'],'abc123');assert.equal(JSON.parse(options.body)[1].year,'FI2026-2027');return html('1:'+JSON.stringify({data:[{...jioFile,title:jioFile.title.replace('31-08-2026',date)}],meta:{pagination:{page:1,pageCount:1,total}}}));}
  return html(url.includes('page-')?'createServerReference)("abc123",a,b,"getDisclosureL3Data")':'<script src="/_next/static/chunks/app/statutory-disclosure/page-test.js"></script>');
};
assert.equal((await publicDisclosures('jio-blackrock',month,jioReader())).length,1);
await assert.rejects(publicDisclosures('jio-blackrock',month,jioReader({total:2})),/Incomplete/);
await assert.rejects(publicDisclosures('jio-blackrock',month,jioReader({date:'31-07-2026'})),/month mismatch/);
const hsbc=await publicDisclosures('hsbc',month,async()=>html('<a href="/document-31082026/hsbc-value-fund-31-aug-2026.xls">Download</a><a href="/document-31072026/hsbc-value-fund-31-jul-2026.xls">Old</a>'));
assert.equal(hsbc.length,1);assert.equal(hsbc[0].text,'hsbc value fund');
const naviReader=(year='2026-2027',title='Portfolio 1st August to 31st August 2026')=>async(url,options)=>{
  if(!options)return html('var navi_property = {"rest_url":"https://navi.com/wp-json/","nonce":"public"};<div data-item="portfolio_portfolio-monthly" data-category="123"></div>');
  assert.equal(new URLSearchParams(options.body).get('financial_year'),year);
  return json({success:true,data:[{title,url:[{link:'https://public-assets.prod.navi-tech.in/monthly.xlsx'}]}]});
};
assert.equal((await publicDisclosures('navi',month,naviReader())).length,1);
assert.equal((await publicDisclosures('navi','2027-01',naviReader('2026-2027','Portfolio 1st January to 31st January 2027'))).length,1);
await assert.rejects(publicDisclosures('navi',month,naviReader('2026-2027','Portfolio 31st July 2026')),/month mismatch/);
const bajajReader=count=>async(url,options)=>{
  if(!options)return html('var bajajDownloads = {"ajaxUrl":"https://www.bajajamc.com/wp-admin/admin-ajax.php","nonce":"public"};<div class="bd-accordion" data-section-id="99"><button>Other</button></div><div class="bd-accordion" data-section-id="123"><button><span>Monthly Portfolio</span></button></div>');
  const form=new URLSearchParams(options.body);assert.equal(form.get('section_id'),'123');assert.equal(form.get('year'),'2026-27');assert.equal(form.get('month'),'August');
  return json({success:true,data:{html:'<a href="https://media.bajajamc.com/monthly.xlsx">Monthly Portfolio</a>',count}});
};
assert.equal((await publicDisclosures('bajaj-finserv',month,bajajReader(1))).length,1);
await assert.rejects(publicDisclosures('bajaj-finserv',month,bajajReader(2)),/Incomplete/);
const alphaData={monthly:[{schemeName:'AlphaGrep Fund',folderName:'fund',financialYears:[{yearFolder:'2026_27',documents:[{fileName:'August_2026'},{fileName:'July_2026'}]}]}]};
const alpha=await publicDisclosures('alphagrep',month,async()=>json(alphaData));
assert.equal(alpha.length,1);assert.match(alpha[0].url,/fund\/monthly\/2026_27\/August_2026.xls$/);
await assert.rejects(publicDisclosures('alphagrep','2026-06',async()=>json(alphaData)),/unavailable/);
const badAlpha=structuredClone(alphaData);badAlpha.monthly[0].folderName='../fund';
await assert.rejects(publicDisclosures('alphagrep',month,async()=>json(badAlpha)),/path/);
const ilfs=await publicDisclosures('il-fs-idf',month,async()=>html('<a href="/ILFS_Portfolio_TransactionReports_August_2026.xlsx">August</a><a href="/ILFS_Portfolio_TransactionReports_July_2026.xlsx">July</a>'));
assert.equal(ilfs.length,1);
console.log('PASS seven official catalogues: pagination, missing pages, duplicate files, reporting periods, fiscal-year rollover, published action discovery and allowed file paths');

const choiceData={Status_code:200,body:{data:[{scheme_name:'Choice Fund',reports:[{report_date:'2026-08-31',file_path:'portfolio-reports/aug.xlsx'},{report_date:'2026-07-31',file_path:'portfolio-reports/jul.xlsx'}]}]}};
assert.equal((await publicDisclosures('choice',month,async()=>json(choiceData))).length,1);
await assert.rejects(publicDisclosures('choice','2026-09',async()=>json(choiceData)),/unavailable/);
choiceData.body.data[0].reports[0].file_path='https://unexpected.test/report.xlsx';
await assert.rejects(publicDisclosures('choice',month,async()=>json(choiceData)),/file/);

for(const [slug,host] of [['tata','https://betacms.tatamutualfund.com'],['edelweiss','https://www.edelweissmf.com']]) {
 const reader=async()=>html(`<a href="${host}/aug.xlsx">Monthly Portfolio Disclosure - August 2026</a><a href="${host}/jul.xlsx">Monthly Portfolio Disclosure - July 2026</a>`);
 assert.equal((await publicDisclosures(slug,month,reader)).length,1);
 await assert.rejects(publicDisclosures(slug,'2026-07',async()=>html('<a href="https://unexpected.test/jul.xlsx">Monthly Portfolio Disclosure - July 2026</a>')),/unavailable/);
}
