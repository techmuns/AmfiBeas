// Official catalogues whose current public download UI supersedes legacy routes.
export const CATALOGUE_PAGES={
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
  edelweiss:['https://www.edelweissmf.com','https://www.advisorkhoj.com'],
  tata:['https://www.tatamutualfund.com','https://betacms.tatamutualfund.com','https://www.advisorkhoj.com'],
  choice:['https://choicemf.com','https://doc.choicemf.com'],
  'canara-robeco':['https://www.canararobeco.com'],
  'jio-blackrock':['https://www.jioblackrockamc.com','https://cdnstorage-ddh3hqhvg3gyedd9.a02.azurefd.net','https://jioinvest.cdn.jio.com'],
  hsbc:['https://www.assetmanagement.hsbc.co.in'],
  navi:['https://navi.com','https://public-assets.prod.navi-tech.in'],
  'bajaj-finserv':['https://www.bajajamc.com','https://media.bajajamc.com'],
  alphagrep:['https://www.alphagrepmf.ai'],
  'il-fs-idf':['https://www.ilfsinfrafund.com'],
};
const names=['January','February','March','April','May','June','July','August','September','October','November','December'];
const config=(html,name)=>{const m=new RegExp(`var ${name}\\s*=\\s*(\\{[^;]*?\\});`).exec(html);if(!m)throw Error('Public catalogue configuration missing');return JSON.parse(m[1]);};
export async function catalogueDisclosures(slug,month,read,{anchorFiles}) {
  const page=CATALOGUE_PAGES[slug],[year,num]=month.split('-').map(Number),name=names[num-1],end=new Date(Date.UTC(year,num,0)).getUTCDate();
  const html=async u=>(await read(u)).toString('utf8'),json=async(u,o)=>JSON.parse((await read(u,o)).toString('utf8'));
  const form=(body,headers={})=>({body:new URLSearchParams(body).toString(),contentType:'application/x-www-form-urlencoded',headers});
  if(slug==='edelweiss'||slug==='tata') {
    // The public index supplies published file links; all holdings come from the
    // AMC's own allowed host and still require matching workbook dates.
    const display=slug==='tata'?'Tata':'Edelweiss';
    const index=`https://www.advisorkhoj.com/mutual-funds-research/mutual-fund-portfolio/${display}-Mutual-Fund/${year}`;
    const links=anchorFiles(await html(index),index).filter(l=>l.text===`Monthly Portfolio Disclosure - ${name} ${year}`);
    const expected=slug==='tata'?'https://betacms.tatamutualfund.com':'https://www.edelweissmf.com';
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
    const response=await read(page,{body:JSON.stringify(['monthly-portfolio-disclosure',{year:`FI${fy}-${fy+1}`,month:name,date:'$undefined'},'MF']),contentType:'text/plain;charset=UTF-8',headers:{accept:'text/x-component','next-action':action}});
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
    return anchorFiles(await html(page),new URL('/',page).href).filter(l=>new RegExp(`/document-${end}${String(num).padStart(2,'0')}${year}/`,'i').test(l.url)).map(l=>({...l,text:decodeURIComponent(new URL(l.url).pathname.split('/').pop()).replace(/-\d{2}-[a-z]+-20\d{2}\.xlsx?$/i,'').replace(/-/g,' ')}));
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
  if(slug==='bajaj-finserv') {
    const source=await html(page),settings=config(source,'bajajDownloads');
    // Match each accordion independently so an earlier section cannot supply its ID.
    const block=source.split(/(?=<div\b[^>]*\bclass="bd-accordion\s*")/).find(s=>/^<div\b/.test(s)&&s.slice(0,s.indexOf('</button>')).includes('>Monthly Portfolio<'));
    const id=block&&/data-section-id="(\d+)"/.exec(block)?.[1];
    if(!id||settings.ajaxUrl!=='https://www.bajajamc.com/wp-admin/admin-ajax.php'||!settings.nonce)throw Error('Monthly catalogue missing');
    const fy=num>=4?year:year-1,financialYear=`${fy}-${String(fy+1).slice(-2)}`;
    const data=await json(settings.ajaxUrl,form({action:'bajaj_get_downloads',nonce:settings.nonce,section_id:id,year:financialYear,month:name}));
    if(data.success!==true||typeof data.data?.html!=='string'||!Number.isSafeInteger(data.data.count))throw Error('Invalid disclosure index');
    const links=anchorFiles(data.data.html,page);
    if(links.length!==data.data.count)throw Error('Incomplete disclosure index');
    return links;
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
