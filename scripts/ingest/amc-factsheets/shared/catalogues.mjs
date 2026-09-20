// Official catalogues whose current public download UI supersedes legacy routes.
import {NEW_AMC_PAGES,NEW_AMC_HOSTS,newAmcDisclosures} from './new-amcs.mjs';
import {previousMonth} from './dates.mjs';
export const CATALOGUE_PAGES={
  ...NEW_AMC_PAGES,
  hdfc:'https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio',
  zerodha:'https://www.zerodhafundhouse.com/resources/disclosures',
  edelweiss:'https://www.edelweissmf.com/statutory/monthly-portfolio',
  tata:'https://www.tatamutualfund.com/schemes-related/portfolio',
  choice:'https://choicemf.com/disclosures/monthly-portfolio',
  'canara-robeco':'https://www.canararobeco.com/documents/statutory-disclosures/scheme-dashboard/scheme-monthly-portfolio/',
  'jio-blackrock':'https://www.jioblackrockamc.com/statutory-disclosure/disclosures/monthly-portfolio-disclosure',
  hsbc:'https://www.assetmanagement.hsbc.co.in/en/mutual-funds/investor-resources/information-library',
  navi:'https://navi.com/mutual-fund/downloads/portfolio',
  'bajaj-finserv':'https://www.bajajamc.com/downloads?statutory-disclosures=',
  alphagrep:'https://www.alphagrepmf.ai/disclosures',
  'il-fs-idf':'https://www.ilfsinfrafund.com/other.php',
};
export const CATALOGUE_HOSTS={
  ...NEW_AMC_HOSTS,
  hdfc:['https://www.hdfcfund.com','https://files.hdfcfund.com'],
  zerodha:['https://www.zerodhafundhouse.com','https://assets.zerodhafundhouse.com'],
  edelweiss:['https://www.edelweissmf.com','https://www.advisorkhoj.com'],
  tata:['https://www.tatamutualfund.com','https://betacms.tatamutualfund.com','https://www.advisorkhoj.com'],
  choice:['https://choicemf.com','https://doc.choicemf.com'],
  'canara-robeco':['https://www.canararobeco.com'],
  'jio-blackrock':['https://www.jioblackrockamc.com','https://cdnstorage-ddh3hqhvg3gyedd9.a02.azurefd.net','https://jioinvest.cdn.jio.com'],
  hsbc:['https://www.assetmanagement.hsbc.co.in'],
  navi:['https://navi.com','https://public-assets.prod.navi-tech.in'],
  'bajaj-finserv':['https://www.bajajamc.com','https://media.bajajamc.com','https://www.advisorkhoj.com'],
  alphagrep:['https://www.alphagrepmf.ai'],
  'il-fs-idf':['https://www.ilfsinfrafund.com'],
};
const names=['January','February','March','April','May','June','July','August','September','October','November','December'];
const config=(html,name)=>{const m=new RegExp(`var ${name}\\s*=\\s*(\\{[^;]*?\\});`).exec(html);if(!m)throw Error('Public catalogue configuration missing');return JSON.parse(m[1]);};
export async function catalogueDisclosures(slug,month,read,{anchorFiles,includeHistory=false}) {
  if(NEW_AMC_PAGES[slug])return newAmcDisclosures(slug,month,read,{anchorFiles});
  const page=CATALOGUE_PAGES[slug],[year,num]=month.split('-').map(Number),name=names[num-1],end=new Date(Date.UTC(year,num,0)).getUTCDate();
  const html=async u=>(await read(u)).toString('utf8'),json=async(u,o)=>JSON.parse((await read(u,o)).toString('utf8'));
  const form=(body,headers={})=>({body:new URLSearchParams(body).toString(),contentType:'application/x-www-form-urlencoded',headers});
  if(slug==='hdfc') {
    // The monthly page publishes individual scheme workbooks, alongside overlap
    // summaries and older periods. Only actual monthly scheme files belong here.
    const links=anchorFiles(await html(page),page),wanted=new RegExp(`^Monthly HDFC (.+) - ${end} ${name} ${year}\\.xlsx?$`,'i');
    return links.flatMap(link=>{
      const label=link.text.replace(/\s+/g,' ').trim(),match=wanted.exec(label);
      if(!match)return [];
      const url=new URL(link.url),file=decodeURIComponent(url.pathname.split('/').pop());
      if(url.origin!=='https://files.hdfcfund.com'||!url.pathname.startsWith('/s3fs-public/')||file!==label)throw Error('Monthly disclosure file mismatch');
      return [{url:url.href,text:'HDFC '+match[1]}];
    });
  }
  if(slug==='zerodha') {
    const source=(await html(page)).replace(/\\"/g,'"'),links=[];
    for(const m of source.matchAll(/"name":"([^"<>]+)","url":"(https:[^"<>]+\.xlsx?)"/g)) {
      if(!new RegExp(`^[A-Z0-9]+ - Monthly Portfolio ${name} ${year}$`).test(m[1]))continue;
      const url=new URL(m[2]);
      if(url.origin!=='https://assets.zerodhafundhouse.com'||!url.pathname.startsWith('/statutory-reports/portfolio-disclosures/'))throw Error('Unexpected monthly file');
      links.push({url:url.href,text:m[1]});
    }
    return links;
  }
  if(slug==='edelweiss'||slug==='tata'||slug==='bajaj-finserv') {
    // The public index supplies published file links; all holdings come from the
    // AMC's own allowed host and still require matching workbook dates.
    const display={tata:'Tata',edelweiss:'Edelweiss','bajaj-finserv':'Bajaj-Finserv'}[slug];
    const index=`https://www.advisorkhoj.com/mutual-funds-research/mutual-fund-portfolio/${display}-Mutual-Fund/${year}`;
    const links=anchorFiles(await html(index),index).filter(l=>l.text===`Monthly Portfolio Disclosure - ${name} ${year}`);
    const expected={tata:'https://betacms.tatamutualfund.com',edelweiss:'https://www.edelweissmf.com','bajaj-finserv':'https://media.bajajamc.com'}[slug];
    if(links.length!==1||new URL(links[0].url).origin!==expected)throw Error('Official monthly file unavailable');
    return links;
  }
  if(slug==='choice') {
    const data=await json('https://choicemf.com/api/monthly-portfolio-report/portfolio-website-list',{body:{}});
    if(data.Status_code!==200||!Array.isArray(data.body?.data))throw Error('Invalid disclosure index');
    return data.body.data.flatMap(s=>{
      if(!s.scheme_name||!Array.isArray(s.reports))throw Error('Invalid scheme catalogue');
      return s.reports.filter(r=>r.report_date===`${month}-${end}`).map(r=>{
        if(!/^\/?portfolio-reports\/[^/]+\.xlsx?$/i.test(r.file_path||''))throw Error('Invalid disclosure file');
        return {url:new URL('/'+r.file_path.replace(/^\//,''),'https://doc.choicemf.com').href,text:s.scheme_name};
      });
    });
  }
  if(slug==='canara-robeco') {
    const first=new URL(page);first.search=new URLSearchParams({filteryear:String(year),filtermonth:String(num).padStart(2,'0')});
    const links=[],seen=new Set();let pages=1;
    for(let p=1;p<=pages;p++) {
      const url=new URL(first);if(p>1)url.searchParams.set('pagination',String(p));
      const source=await html(url.href),files=anchorFiles(source,page).filter(l=>!/^Download$/i.test(l.text));
      if(!files.length)throw Error('Incomplete disclosure index');
      const pageNos=[...source.matchAll(/href=["']([^"']*pagination=\d+[^"']*)["']/g)].map(m=>{
        const next=new URL(m[1].replace(/&amp;/g,'&'),page);
        if(next.origin!==first.origin||next.pathname!==first.pathname||next.searchParams.get('filteryear')!==String(year)||next.searchParams.get('filtermonth')!==String(num).padStart(2,'0'))throw Error('Unexpected catalogue page');
        return Number(next.searchParams.get('pagination'));
      });
      const count=Math.max(1,...pageNos);
      if(!Number.isSafeInteger(count)||count>50||p>1&&count!==pages)throw Error('Disclosure index changed');pages=count;
      for(const file of files) {
        const label=file.text.replace(/&#8211;|&#8212;|[–—-]/g,' ').replace(/\s+/g,' ').trim();
        if(!new RegExp(`${name} ${year}$`,'i').test(label))throw Error('Disclosure month mismatch');
        if(seen.has(file.url))throw Error('Repeated disclosure page');seen.add(file.url);
        links.push({...file,text:label.replace(/^[A-Z]{2} /,'').replace(new RegExp(` ${name} ${year}$`,'i'),'')});
      }
    }
    return links;
  }
  if(slug==='jio-blackrock') {
    const source=await html(page);
    const chunks=[...source.matchAll(/<script[^>]+src="([^" ]+)"/g)].map(m=>m[1]).filter(u=>u.includes('statutory-disclosure')&&u.includes('page-'));
    if(chunks.length!==1)throw Error('Disclosure client unavailable');
    const client=await html(new URL(chunks[0],page).href);
    const action=/createServerReference\)\("([a-f0-9]+)"[^;]+"getDisclosureL3Data"/.exec(client)?.[1];
    if(!action)throw Error('Disclosure action unavailable');
    const fy=num>=4?year:year-1;
    const response=await read(page,{body:JSON.stringify(['monthly-portfolio-disclosure',{year:`FI${fy}-${fy+1}`,month:name,date:'$undefined'},'MF']),contentType:'text/plain;charset=UTF-8',headers:{accept:'text/x-component','next-action':action,origin:new URL(page).origin,referer:page,'next-router-state-tree':'%5B%22%22%2C%7B%22children%22%3A%5B%22(mf)%22%2C%7B%22children%22%3A%5B%22(public)%22%2C%7B%22children%22%3A%5B%22statutory-disclosure%22%2C%7B%22children%22%3A%5B%5B%22l1Id%22%2C%22disclosures%22%2C%22d%22%5D%2C%7B%22children%22%3A%5B%5B%22l2Id%22%2C%22monthly-portfolio-disclosure%22%2C%22d%22%5D%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D'}});
    const line=response.toString('utf8').split('\n').find(l=>/^1:\{/.test(l));
    const data=line&&JSON.parse(line.slice(2)),pagination=data?.meta?.pagination;
    if(!Array.isArray(data?.data)||pagination?.page!==1||pagination?.pageCount!==1||pagination.total!==data.data.length)throw Error('Incomplete disclosure index');
    return data.data.filter(d=>!/^JioBlackRock Mutual Fund-Monthly-Portfolio-/i.test(d.title||'')).map(d=>{
      if(d.docType!=='file'||!new RegExp(`-Monthly-Portfolio-${end}-${String(num).padStart(2,'0')}-${year}$`,'i').test(d.title||''))throw Error('Disclosure month mismatch');
      return {url:d.file?.url,text:d.title.replace(/-Monthly-Portfolio-.*$/i,'')};
    });
  }
  if(slug==='hsbc') {
    // The official links use "aug", not the full month used by the legacy guesser.
    const periods=new Map();let wanted=month;
    for(let i=0;i<(includeHistory?4:1);i++) {
      const [y,m]=wanted.split('-').map(Number),day=new Date(Date.UTC(y,m,0)).getUTCDate();
      periods.set(`${day}${String(m).padStart(2,'0')}${y}`,wanted);wanted=previousMonth(wanted);
    }
    return anchorFiles(await html(page),new URL('/',page).href).flatMap(link=>{
      // Month-end debt reports are also mirrored in the fortnightly directory.
      // Mixing that catalogue into monthly holdings would count hybrid shares twice.
      const period=periods.get(/\/mutual-funds\/portfolios\/document-(\d{8})\//i.exec(new URL(link.url).pathname)?.[1]);
      if(!period)return [];
      return [{...link,text:decodeURIComponent(new URL(link.url).pathname.split('/').pop()).replace(/-\d{2}-[a-z]+-20\d{2}\.xlsx?$/i,'').replace(/-/g,' '),...(includeHistory?{disclosureMonth:period}:{})}];
    });
  }
  if(slug==='il-fs-idf')return anchorFiles(await html(page),page).filter(l=>new RegExp(`/ILFS_Portfolio_TransactionReports_${name}_${year}\\.xlsx?$`,'i').test(l.url));
  if(slug==='navi') {
    const source=await html(page),settings=config(source,'navi_property');
    const category=/<[^>]*data-item="portfolio_portfolio-monthly"[^>]*data-category="(\d+)"/i.exec(source)?.[1];
    if(!category||settings.rest_url!=='https://navi.com/wp-json/'||!settings.nonce)throw Error('Monthly catalogue missing');
    const fy=num>=4?year:year-1;
    const data=await json(settings.rest_url+'nv/v1/documents',form({financial_year:`${fy}-${fy+1}`,value:name,category,type:'Monthly',order:'DESC'},{'WP-NONCE':settings.nonce}));
    if(data.success!==true||!Array.isArray(data.data))throw Error('Invalid disclosure index');
    return data.data.flatMap(d=>{
      if(!new RegExp(`${end}(?:st|nd|rd|th)? ${name} ${year}$`,'i').test(d.title||''))throw Error('Disclosure index month mismatch');
      const files=Array.isArray(d.url)?d.url.map(f=>f.link):[d.url];
      if(!files.some(url=>/\.xlsx?$/i.test(url||'')))throw Error('Monthly workbook missing');
      return files.filter(url=>/\.xlsx?$/i.test(url||'')).map(url=>({url,text:d.title.replace(/\s+1st.*$/i,'')}));
    });
  }
  if(slug==='alphagrep') {
    const data=await json('https://www.alphagrepmf.ai/assets/documents/files.json');
    if(!Array.isArray(data.monthly))throw Error('Invalid disclosure index');
    return data.monthly.flatMap(s=>{
      if(!s.schemeName||!Array.isArray(s.financialYears))throw Error('Invalid scheme catalogue');
      return s.financialYears.flatMap(fy=>{
        if(!Array.isArray(fy.documents))throw Error('Invalid reporting-year catalogue');
        return fy.documents.filter(d=>d.fileName===`${name}_${year}`).map(d=>{
          for(const part of [s.folderName,fy.yearFolder,d.fileName])if(!/^[a-z0-9_-]+$/i.test(part||''))throw Error('Invalid disclosure path');
          // Same path composition as the site's Monthly > scheme > year download.
          return {url:`https://www.alphagrepmf.ai/assets/documents/${s.folderName}/monthly/${fy.yearFolder}/${d.fileName}.xls`,text:s.schemeName};
        });
      });
    });
  }
  throw Error('Unknown catalogue');
}
