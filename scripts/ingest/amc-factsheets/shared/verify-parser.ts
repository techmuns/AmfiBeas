import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {parseAmcWorkbook} from '../parse';
import {downloadAndParse} from '../page-scrape';
import {stampAsOfFromLinks} from '../months';
const header=['Name of Instrument','ISIN','Industry','Quantity','Market Value (Rs in Lacs)','% to NAV'];
const parse=(name:string,rows:unknown[][])=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),name);return parseAmcWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{pctScale:1,valueToCr:100});};
const holding=['Company','INE040A01034','Banks',100,200,40];
for(const title of ['Example Nifty200 Value 30 Index Fund','Example Nifty SDL Apr 2032 Top 12 Index Fund']){
 const [s]=parse('TEST',[[`Portfolio of ${title} as on 31-Aug-2026`],header,holding]);assert.equal(s.asOf,'2026-08-31');assert.equal(s.schemeName,title);
}
for(const title of ['Example Money Market Fund','Example Dynamic Asset Allocation Omni FOF','Example Bal Bhavishya Yojna']){
 const [s]=parse('CODE',[['CODE',title],['An open ended fund investing in mutual fund units'],['Portfolio Statement as on August 31, 2026'],header,['Mutual Fund Units'],holding]);assert.equal(s.schemeName,title);
}
const [split]=parse('Fund',[['Example Value Fund'],['Portfolio as on August 31, 2026'],header,['Equity & Equity related'],holding,['ARBITRAGE'],['Company','INE040A01034','Banks',75,150,30]]);
assert.equal(split.holdings.length,1);assert.equal(split.holdings[0].quantity,175);assert.equal(split.holdings[0].pctToNav,70);
const [duplicate]=parse('Fund',[['Example Value Fund'],['Portfolio as on August 31, 2026'],header,['Equity & Equity related'],holding,holding]);assert.equal(duplicate.holdings.length,2,'Same-section duplicates stay visible to validation');
const [derivative]=parse('Fund',[['Example Hybrid Fund'],['Portfolio as on August 31, 2026'],header,['Equity & Equity related'],holding,['Derivatives'],['Company^','INE040A01034','Banks',30,20,5]]);assert.equal(derivative.holdings[1].sourceSection,'Derivatives');assert.equal(derivative.holdings.length,2);
console.log('PASS workbook regression: dates containing fund-name numbers, explicit scheme identities, cash/arbitrage lots, true duplicates and derivative section provenance');

for(const title of ['Example Growth Fund (An open-ended equity scheme predominantly investing in mid cap stocks)','Example Term Fund - An Open Ended Dynamic Term Scheme investing across duration']) {
 const [s]=parse('CODE',[['INTERNAL',title],['Monthly Portfolio Statement as on August 31,2026'],header,holding]);
 assert.match(s.schemeName,/^Example /);assert.notEqual(s.schemeName,'CODE');
}

const dated=parse('Fund',[['Example Apr 2032 Fund'],['Portfolio as on August 31, 2026'],header,holding]);assert.equal(dated[0].asOf,'2026-08-31');
const prior={...dated[0],asOf:'2026-07-31'};stampAsOfFromLinks([prior],[{url:'https://example.test/Portfolio_August_2026.xlsx'}],new Date('2026-09-20'));assert.equal(prior.asOf,'2026-07-31');
const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Example Fund'],['Portfolio as on August 31,2026'],header,holding]),'Fund');
const report=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
const partial=downloadAndParse(['valid','failed','html'].map(n=>({url:`https://example.test/${n}.xlsx`,text:n})),{pctScale:1,valueToCr:100},undefined,url=>url.includes('valid')?report:url.includes('html')?Buffer.from('<html>Unavailable</html>'):null);
assert.equal(partial.schemes.length,1);assert.equal(partial.expectedFiles,3);assert.equal(partial.completedFiles,1);assert.equal(partial.failedFiles,2);

const damaged=XLSX.utils.book_new();XLSX.utils.book_append_sheet(damaged,XLSX.utils.aoa_to_sheet([['Example Fund'],['ISIN','Quantity','Missing other columns'],holding]),'Damaged');
assert.throws(()=>parseAmcWorkbook(XLSX.write(damaged,{type:'buffer',bookType:'xlsx'}),{pctScale:1,valueToCr:100,strictHoldings:true}),/Unparsed/);

const [motilal]=parse('YO01',[['Back to Index'],['Example Asset Management Company Limited'],['(Investment Manager for Example Mutual Fund)'],['Registered Office: City'],['Monthly Portfolio Statement as on August 31, 2026'],['Example Nifty 50 ETF'],header,holding]);assert.equal(motilal.schemeName,'Example Nifty 50 ETF');
XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Notes: Example Fund'],['Historical transaction','INE040A01034']]),'Notes');
assert.equal(parseAmcWorkbook(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{pctScale:1,valueToCr:100,strictHoldings:true}).length,1);

XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Scheme plans'],['ISIN','Scheme Name'],['INF209K01WE3','Example Plan']]),'Contents');
assert.equal(parseAmcWorkbook(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{pctScale:1,valueToCr:100,strictHoldings:true}).length,1);

for(const label of ['Portfolio as on 31st August 2026','Portfolio as on 31/08/2026','Portfolio as on 2026-08-31','MONTHLY PORTFOLIO STATEMENT OF EXAMPLE INDEX FUND FOR AUGUST 2026']) {
 const [s]=parse('Fund',[['Example Index Fund'],['Inception 22-Feb-2026'],[label],header,holding]);assert.equal(s.asOf,'2026-08-31',label);
}

const [undated]=parse("Fund",[["Example Hybrid Fund"],["Inception 22-Feb-2026"],header,["Bond maturing 23-Jan-2026","INE040A01034","Debt",46265,200,40]]);
assert.equal(undated.asOf,null,"A holding maturity, quantity or inception date is not the reporting date");
stampAsOfFromLinks([undated],[{url:"https://example.test/Portfolio_August_2026.xlsx"}],new Date("2026-09-20"));
assert.equal(undated.asOf,"2026-08-31");
