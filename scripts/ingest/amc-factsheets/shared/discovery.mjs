import {monthKey} from './dates.mjs';
import {periodNotListed} from './source-errors.mjs';
export const STATUTORY_PAGES={abakkus:'https://www.abakkusmf.com/statutory-disclosures.html','old-bridge':'https://oldbridgemf.com/statutory-disclosures.html'};
// These pages changed their rendered sections in September 2026. Read only
// published file links and labels; never execute scripts embedded in a source page.
export function statutoryLinks(slug,html,month) {
  const page=STATUTORY_PAGES[slug];if(!page)return [];
  const links=new Set(),listed=new Set();
  if(slug==='abakkus') {
    const raw=/<script\b[^>]*\bid=["\']verticals-data["\'][^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1] || /const verticals\s*=\s*(\[[\s\S]*?\]);/.exec(html)?.[1];
    if(!raw)throw Error('Monthly catalogue missing');
    const verticals=JSON.parse(raw),monthly=verticals.filter(v=>v.title==='Monthly Portfolio Disclosures');
    if(monthly.length!==1||!Array.isArray(monthly[0].sections))throw Error('Monthly catalogue ambiguous');
    const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
    for(const section of monthly[0].sections)for(const group of section.subSections||[])for(const item of group.items||[]) {
      const date=/^([A-Za-z]+)\s+(\d{1,2}),\s*(20\d{2})$/.exec(item.title||'');
      if(!date)continue;
      const period=monthKey(`${date[1].slice(0,3)}-${date[3]}`);
      if(period&&Number(date[2])===new Date(Date.UTC(Number(date[3]),Number(period.slice(5)),0)).getUTCDate())listed.add(period);
      if(Number(date[2])!==end||period!==month)continue;
      const url=new URL(item.downloadMedia?.url||item.downloadUrl,page);
      if(url.origin!==new URL(page).origin||!/^\/uploads\/.+\.xlsx?$/i.test(url.pathname))throw Error('Invalid monthly file');
      links.add(url.href);
    }
  }
  if(slug==='old-bridge')for(const m of html.matchAll(/<h[234][^>]*>([^<]+)<\/h[234]>\s*<a[^>]*href="(\/uploads\/[^"<>]+\.xlsx?)"/g)) {
    const date=/-\s*([A-Za-z]+)\s+(20\d{2})\s*$/.exec(m[1]);
    if(date && /fund/i.test(m[1])) {const period=monthKey(`${date[1].slice(0,3)}-${date[2]}`);if(period)listed.add(period);if(period===month)links.add(new URL(m[2],page).href);}
  }
  if(!links.size&&listed.size)throw periodNotListed(month,[...listed]);
  return [...links].map(url=>({url,text:month}));
}
