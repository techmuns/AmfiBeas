import assert from 'node:assert/strict';
import {publicDisclosures} from './public-disclosures.mjs';
const month='2026-08',json=value=>Buffer.from(JSON.stringify(value)),html=value=>Buffer.from(value);
const hdfcAnchor=(label,file=label)=>`<a href="https://files.hdfcfund.com/s3fs-public/2026-09/${encodeURIComponent(file)}">${label}</a>`;
const hdfcCurrent='Monthly HDFC Value Fund - 31 August 2026.xlsx';
const hdfc=await publicDisclosures('hdfc',month,async()=>html(hdfcAnchor(hdfcCurrent)+hdfcAnchor('Monthly HDFC Value Fund - 31 July 2026.xlsx')+hdfcAnchor('PortfolioOverlap31Aug2026.xlsx')));
assert.equal(hdfc.length,1);assert.equal(hdfc[0].text,'HDFC Value Fund');
await assert.rejects(publicDisclosures('hdfc',month,async()=>html(hdfcAnchor(hdfcCurrent,'Monthly HDFC Value Fund - 31 July 2026.xlsx'))),/file mismatch/);
await assert.rejects(publicDisclosures('hdfc',month,async()=>html(hdfcAnchor(hdfcCurrent).replace('files.hdfcfund.com','other.test'))),/file mismatch/);
await assert.rejects(publicDisclosures('hdfc','2026-09',async()=>html(hdfcAnchor(hdfcCurrent))),/unavailable/);
assert.equal((await publicDisclosures('hdfc','2028-02',async()=>html(hdfcAnchor('Monthly HDFC Value Fund - 29 February 2028.xlsx')))).length,1);
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
  if(options){assert.equal(options.headers['next-action'],'abc123');assert.equal(options.headers.origin,'https://www.jioblackrockamc.com');assert.equal(options.headers.referer,url);assert.match(decodeURIComponent(options.headers['next-router-state-tree']),/monthly-portfolio-disclosure/);assert.equal(JSON.parse(options.body)[1].year,'FI2026-2027');return html('1:'+JSON.stringify({data:[{...jioFile,title:jioFile.title.replace('31-08-2026',date)}],meta:{pagination:{page:1,pageCount:1,total}}}));}
  return html(url.includes('page-')?'createServerReference)("abc123",a,b,"getDisclosureL3Data")':'<script src="/_next/static/chunks/app/statutory-disclosure/page-test.js"></script>');
};
assert.equal((await publicDisclosures('jio-blackrock',month,jioReader())).length,1);
await assert.rejects(publicDisclosures('jio-blackrock',month,jioReader({total:2})),/Incomplete/);
await assert.rejects(publicDisclosures('jio-blackrock',month,jioReader({date:'31-07-2026'})),/month mismatch/);
const hsbc=await publicDisclosures('hsbc',month,async()=>html('<a href="/mutual-funds/portfolios/document-31082026/hsbc-value-fund-31-aug-2026.xls">Download</a><a href="/mutual-funds/portfolios/document-31072026/hsbc-value-fund-31-jul-2026.xls">Old</a>'));
assert.equal(hsbc.length,1);assert.equal(hsbc[0].text,'hsbc value fund');
const hsbcHistoryHtml=html('<a href="/mutual-funds/fortnightly-debt-portfolio/document-31082026/hsbc-value-fund.xlsx">Mirror</a>'+ ['30042026','31052026','30062026','31072026','31082026'].map(date=>`<a href="/mutual-funds/portfolios/document-${date}/hsbc-value-fund.xlsx">Download</a>`).join(''));
const hsbcHistory=await publicDisclosures('hsbc',month,async()=>hsbcHistoryHtml,{includeHistory:true});
assert.deepEqual(hsbcHistory.map(file=>file.disclosureMonth),['2026-08','2026-07','2026-06','2026-05']);
await assert.rejects(publicDisclosures('hsbc','2026-09',async()=>hsbcHistoryHtml,{includeHistory:true}),/Current monthly/);
const hsbcRollover=await publicDisclosures('hsbc','2027-01',async()=>html(['31012027','31122026','30112026','31102026'].map(date=>`<a href="/mutual-funds/portfolios/document-${date}/hsbc-value-fund.xlsx">Download</a>`).join('')),{includeHistory:true});
assert.deepEqual(hsbcRollover.map(file=>file.disclosureMonth),['2027-01','2026-12','2026-11','2026-10']);
const naviReader=(year='2026-2027',title='Portfolio 1st August to 31st August 2026')=>async(url,options)=>{
  if(!options)return html('var navi_property = {"rest_url":"https://navi.com/wp-json/","nonce":"public"};<div data-item="portfolio_portfolio-monthly" data-category="123"></div>');
  assert.equal(new URLSearchParams(options.body).get('financial_year'),year);
  return json({success:true,data:[{title,url:[{link:'https://public-assets.prod.navi-tech.in/monthly.xlsx'}]}]});
};
assert.equal((await publicDisclosures('navi',month,naviReader())).length,1);
assert.equal((await publicDisclosures('navi','2027-01',naviReader('2026-2027','Portfolio 1st January to 31st January 2027'))).length,1);
await assert.rejects(publicDisclosures('navi',month,naviReader('2026-2027','Portfolio 31st July 2026')),/month mismatch/);
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

for(const [slug,host] of [['tata','https://betacms.tatamutualfund.com'],['edelweiss','https://www.edelweissmf.com'],['bajaj-finserv','https://media.bajajamc.com']]) {
 const reader=async()=>html(`<a href="${host}/aug.xlsx">Monthly Portfolio Disclosure - August 2026</a><a href="${host}/jul.xlsx">Monthly Portfolio Disclosure - July 2026</a>`);
 assert.equal((await publicDisclosures(slug,month,reader)).length,1);
 await assert.rejects(publicDisclosures(slug,'2026-07',async()=>html('<a href="https://unexpected.test/jul.xlsx">Monthly Portfolio Disclosure - July 2026</a>')),/unavailable/);
}

const zerodha=await publicDisclosures('zerodha',month,async()=>html(JSON.stringify({files:[{name:'ZOVER - Monthly Portfolio August 2026',url:'https://assets.zerodhafundhouse.com/statutory-reports/portfolio-disclosures/ZOVER - Monthly Portfolio August 2026.xlsx'},{name:'ZOVER - Half-Yearly Portfolio August 2026',url:'https://assets.zerodhafundhouse.com/statutory-reports/portfolio-disclosures/half.xlsx'}]})));
assert.equal(zerodha.length,1);assert.match(zerodha[0].url,/ZOVER%20/);
