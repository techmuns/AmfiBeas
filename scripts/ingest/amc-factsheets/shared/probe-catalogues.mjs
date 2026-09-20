// Read-only diagnostics: no holdings, source checkpoints or production jobs change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PUBLIC_PAGES,publicDisclosures,publicReader} from './public-disclosures.mjs';
import {sourceFailure} from './source-errors.mjs';
import {targetMonth} from './dates.mjs';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/amc-holdings/coverage.json')));
const wanted=process.env.MF_PROBE_AMCS?.split(',').filter(Boolean)||manifest.amcs.filter(a=>a.status!=='ok'||a.month!==targetMonth()).map(a=>a.slug);
const results=[];
const file=process.env.MF_DIAGNOSTICS_FILE||path.join(os.tmpdir(),'amc-catalogue-diagnostics.json');
const save=()=>fs.writeFileSync(file,JSON.stringify({checkedAt:new Date().toISOString(),targetMonth:targetMonth(),scope:'Public catalogue access only; does not establish complete or validated holdings',pending:wanted.filter(s=>!results.some(r=>r.slug===s)),results},null,2));
save();
for(const slug of wanted) {
  if(!PUBLIC_PAGES[slug]){results.push({slug,status:'not-probed',reason:'No standalone public-catalogue probe; source coverage remains authoritative'});save();continue;}
  try {
    const axisPublicToken=slug==='axis'?/const AXIS_TOKEN\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(root,'scripts/ingest/amc-factsheets/json-api.ts'),'utf8'))?.[1]:undefined;
    const links=await publicDisclosures(slug,targetMonth(),publicReader(slug),{axisPublicToken});
    results.push({slug,status:'catalogue-readable',files:links.length});
  }catch(error){results.push({slug,status:'unavailable',failure:sourceFailure(error)});}
  save();
  console.log(JSON.stringify(results.at(-1)));
}
