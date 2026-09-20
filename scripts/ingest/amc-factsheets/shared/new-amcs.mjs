// Published document sites for newer AMFI members whose directory links lag.
// Missing monthly reports remain unavailable; fortnightly data cannot replace them.
export const NEW_AMC_PAGES={
  ask:'https://www.askmutualfund.com/pages/downloads.html',
  monarch:'https://www.monarchamc.in/forms-downloads/statutory/policies',
  lakshya:'https://lakshyafunds.com/compliance',
};
export const NEW_AMC_HOSTS={ask:['https://www.askmutualfund.com'],monarch:['https://www.monarchamc.in'],lakshya:['https://lakshyafunds.com']};
const names=['January','February','March','April','May','June','July','August','September','October','November','December'];
const plain=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function monthEndLabel(label,month) {
  const [year,num]=month.split('-').map(Number),day=new Date(Date.UTC(year,num,0)).getUTCDate(),name=names[num-1];
  return new RegExp(`(?:^|\\D)(?:${day}[ /_-]*${String(num).padStart(2,'0')}[ /_-]*${year}|${day}(?:st|nd|rd|th)?[ _-]+${name}[ _-]+${year})(?:\\D|$)`,'i').test(label);
}
// Decode only JSON data chunks. Do not execute Next client code.
export function nextRecords(html) {
  let stream='';const found=[];
  for(const match of html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)) {
    try{const value=JSON.parse(match[1]);if(typeof value[1]==='string')stream+=value[1];}catch{/* Non-data chunk. */}
  }
  function visit(value) {if(!value||typeof value!=='object')return;found.push(value);for(const child of Object.values(value))visit(child);}
  for(const line of stream.split('\n')) {const match=/^[\da-f]+:(.*)$/.exec(line);if(match)try{visit(JSON.parse(match[1]));}catch{/* Module references are not JSON objects. */}}
  return found;
}
export async function newAmcDisclosures(slug,month,read,{anchorFiles}) {
  const page=NEW_AMC_PAGES[slug],html=async url=>(await read(url)).toString('utf8');
  if(slug==='ask') {
    const source=await html(page),section=/<h2[^>]*>\s*Portfolio Disclosures\s*<\/h2>([\s\S]*?)(?=<h2\b|$)/i.exec(source)?.[1];
    if(!section)throw Error('Monthly catalogue missing');
    const links=[];
    for(const match of section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const label=plain(/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(match[1])?.[1]);
      if(!/\bMonthly Portfolio Disclosures?\b/i.test(label)||!monthEndLabel(label,month))continue;
      // The SPA resolves ./assests from the site root, not the page fragment URL.
      const files=anchorFiles(match[1],new URL('/',page).href);
      if(files.length!==1)throw Error('Monthly workbook missing');
      links.push({...files[0],text:label.replace(/\s+Monthly Portfolio Disclosures?.*$/i,'')});
    }
    return links;
  }
  if(slug==='lakshya') {
    const schemes=JSON.parse(await html(new URL('/api/ext/schemes',page).href)),ids=new Set();
    if(!Array.isArray(schemes)||!schemes.length)throw Error('Invalid scheme catalogue');
    return schemes.map(s=>{
      if(!/^[A-F0-9-]{36}$/i.test(s.scheme_id||'')||!s.scheme_name||ids.has(s.scheme_id))throw Error('Invalid scheme catalogue');
      ids.add(s.scheme_id);
      const url=new URL('/api/ext/disclosures/portfolio-disclosure/download',page);
      url.search=new URLSearchParams({scheme_id:s.scheme_id,reporting_month:String(Number(month.slice(5))),reporting_year:month.slice(0,4)});
      return {url:url.href,text:s.scheme_name};
    });
  }
  if(slug==='monarch') {
    const groups=nextRecords(await html(page)).filter(v=>v.name==='Portfolio Holdings'&&Array.isArray(v.download_category_level_2s));
    if(groups.length!==1||groups[0].slug!=='/portfolio-holdings')throw Error('Monthly catalogue missing');
    const monthly=groups[0].download_category_level_2s.filter(v=>/^Monthly$/i.test(v.name));
    if(!monthly.length)return [];
    if(monthly.length!==1||monthly[0].slug!=='/monthly')throw Error('Invalid disclosure index');
    const base=new URL('/forms-downloads/portfolio-holdings/monthly',page),links=[],ids=new Set();let total=null,pages=1;
    for(let p=1;p<=pages;p++) {
      const url=new URL(base);if(p>1)url.searchParams.set('page',String(p));
      const payloads=nextRecords(await html(url.href)).filter(v=>v.pagination&&Array.isArray(v.downloads));
      if(payloads.length!==1)throw Error('Invalid disclosure index');
      const {downloads,pagination:meta}=payloads[0];
      if(meta.page!==p||!Number.isSafeInteger(meta.total)||meta.total<0||!Number.isSafeInteger(meta.pageCount)||meta.pageCount<1||meta.pageCount>100||total!==null&&(total!==meta.total||pages!==meta.pageCount))throw Error('Disclosure index changed');
      pages=meta.pageCount;total=meta.total;
      for(const item of downloads) {
        if(!item.id||ids.has(item.id))throw Error('Repeated disclosure page');ids.add(item.id);
        if(!/\bMonthly\b/i.test(item.name||'')||!monthEndLabel(item.name,month))continue;
        if(!/^\/uploads\/[^/]+\.xlsx?$/i.test(item.attachment?.url||''))throw Error('Monthly workbook missing');
        links.push({url:new URL(item.attachment.url,page).href,text:item.name.replace(/^Monthly\s*-\s*/i,'').replace(/\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+20\d{2}$/,'')});
      }
      if(ids.size>total||!downloads.length&&total>0)throw Error('Incomplete disclosure index');
    }
    if(ids.size!==total)throw Error('Incomplete disclosure index');
    return links;
  }
  throw Error('Unknown catalogue');
}
