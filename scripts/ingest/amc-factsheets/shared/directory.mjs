import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {atomicJson} from './source-pool.mjs';
export const AMFI_DIRECTORY='https://www.amfiindia.com/online-center/portfolio-disclosure';

// Read the directory data embedded in AMFI's public page, never execute its scripts.
export function parseDirectory(html) {
  const chunks=[];
  for(const match of html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)) {
    try{const value=JSON.parse(match[1]);if(typeof value[1]==='string')chunks.push(value[1]);}catch{/* Not a JSON data chunk. */}
  }
  const records=new Map();
  function visit(value) {
    if(!value||typeof value!=='object')return;
    if(value.mf_id&&value.mf_name&&Object.hasOwn(value,'amc_monthly_portfolio_disclosure')) {
      const id=String(value.mf_id),name=String(value.mf_name),url=value.amc_monthly_portfolio_disclosure||null;
      if(url){const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Invalid disclosure URL');}
      const item={id,name,url};
      if(records.has(id)&&JSON.stringify(records.get(id))!==JSON.stringify(item))throw Error('Conflicting AMC directory');
      records.set(id,item);return;
    }
    for(const child of Object.values(value))visit(child);
  }
  for(const line of chunks.join('').split('\n')) {
    const match=/^[\da-f]+:(.*)$/.exec(line);if(!match)continue;
    let value;try{value=JSON.parse(match[1]);}catch{continue;}
    visit(value);
  }
  if(!records.size||records.size>500)throw Error('AMC directory unavailable');
  return [...records.values()];
}

export async function syncDirectory(root,{read=()=>execFileSync('curl',['--fail','--silent','--show-error','--max-time','20','--max-filesize','2000000',AMFI_DIRECTORY],{encoding:'utf8',timeout:25000,maxBuffer:2000000})}={}) {
  const dir=path.join(root,'public/amc-holdings'),file=path.join(dir,'directory.json');
  const old=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
  const lastAttemptAt=new Date().toISOString();
  try {
    const records=parseDirectory(await read());
    if(old.records?.some(p=>!records.some(n=>n.id===p.id)))throw Error('AMC directory lost members');
    const {slugFor}=await import('../advisorkhoj.ts');
    const indexFile=path.join(dir,'index.json'),index=JSON.parse(fs.readFileSync(indexFile));
    const aliases={'Mahindra Manulife Mutual Fund':'mahindra'};
    for(const item of records) {
      const slug=aliases[item.name]||slugFor(item.name);
      if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw Error('Invalid AMC identity');
      let entry=index.amcs.find(e=>e.slug===slug||e.amfiId===item.id);
      if(!entry){entry={slug,amc:item.name,status:'unavailable',asOfMonth:null,schemes:0,holdings:0,file:null,updatedAt:null};index.amcs.push(entry);}
      Object.assign(entry,{amfiId:item.id,monthlyDisclosureUrl:item.url});
    }
    atomicJson(indexFile,index);
    const result={status:'ok',checkedAt:lastAttemptAt,lastAttemptAt,source:AMFI_DIRECTORY,records};
    atomicJson(file,result);return result;
  }catch(error){const result={...old,status:'unavailable',lastAttemptAt,reason:error.message,source:AMFI_DIRECTORY};atomicJson(file,result);return result;}
}
