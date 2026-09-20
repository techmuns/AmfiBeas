import {monthKey} from './dates.mjs';
export const STATUTORY_PAGES={abakkus:'https://www.abakkusmf.com/statutory-disclosures.html','old-bridge':'https://oldbridgemf.com/statutory-disclosures.html'};
// These pages changed their rendered sections in September 2026. Read only
// published file links and labels; never execute scripts embedded in a source page.
export function statutoryLinks(slug,html,month) {
  const page=STATUTORY_PAGES[slug];if(!page)return [];
  const links=new Set();
  if(slug==='abakkus') {
    const raw=/const verticals\s*=\s*(\[[\s\S]*?\]);/.exec(html)?.[1];
    if(!raw)throw Error('Monthly catalogue missing');
    const verticals=JSON.parse(raw),monthly=verticals.filter(v=>v.title==='Monthly Portfolio Disclosures');
    if(monthly.length!==1||!Array.isArray(monthly[0].sections))throw Error('Monthly catalogue ambiguous');
    const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
    for(const section of monthly[0].sections)for(const group of section.subSections||[])for(const item of group.items||[]) {
      const date=/^([A-Za-z]+)\s+(\d{1,2}),\s*(20\d{2})$/.exec(item.title||'');
      if(!date||Number(date[2])!==end||monthKey(`${date[1].slice(0,3)}-${date[3]}`)!==month)continue;
      const url=new URL(item.downloadMedia?.url||item.downloadUrl,page);
      if(url.origin!==new URL(page).origin||!/^\/uploads\/.+\.xlsx?$/i.test(url.pathname))throw Error('Invalid monthly file');
      links.add(url.href);
    }
  }
  if(slug==='old-bridge')for(const m of html.matchAll(/<h[234][^>]*>([^<]+)<\/h[234]>\s*<a[^>]*href="(\/uploads\/[^"<>]+\.xlsx?)"/g)) {
    const date=/-\s*([A-Za-z]+)\s+(20\d{2})\s*$/.exec(m[1]);
    if(date && /fund/i.test(m[1]) && monthKey(`${date[1].slice(0,3)}-${date[2]}`)===month)links.add(new URL(m[2],page).href);
  }
  return [...links].map(url=>({url,text:month}));
}
