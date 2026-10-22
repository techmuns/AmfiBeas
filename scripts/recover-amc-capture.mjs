import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO='techmuns/AmfiBeas',WORKFLOW='amc-factsheet-monthly.yml';
const ROOT=`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`;
const ACTIVE=['queued','in_progress','waiting','requested','pending'];
const failure=code=>Object.assign(Error(code),{code});
const time=(value,now)=>{const t=Date.parse(value);if(!Number.isFinite(t)||t>now+60000)throw failure('invalid-run-time');return t;};
export function amcRecoveryDecision(runs,now=Date.now()) {
  if(runs.some(r=>ACTIVE.includes(r.status)))return {due:false,reason:'already-running'};
  const latest=runs.filter(r=>!r.display_title?.includes('scheme-benchmarks'))
    .sort((a,b)=>time(b.created_at,now)-time(a.created_at,now))[0];
  if(!latest)return {due:true,reason:'no-monthly-run'};
  time(latest.created_at,now);
  const due=now-time(latest.updated_at,now)>=15*60000;
  return {due,reason:due?'overdue':'recent-run',run:latest.id};
}
export async function recoverAmcCapture({repository=REPO,token,fetcher=fetch,now=Date.now(),apply=false}={}) {
  if(repository!==REPO||!token)throw failure('configuration');
  const request=async(suffix,body)=>{
    let response;
    try { response=await fetcher(ROOT+suffix,{method:body?'POST':'GET',redirect:'error',
      headers:{accept:'application/vnd.github+json','x-github-api-version':'2022-11-28',authorization:`Bearer ${token}`,
        'user-agent':'amfi-capture-recovery',...(body?{'content-type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)}); }
    catch(error){throw body?failure('dispatch-uncertain'):error;}
    if(!response.ok){await response.body?.cancel();throw failure(body&&response.status>=500?'dispatch-uncertain':`github-${response.status}`);}
    if(body){if(response.status!==204)throw failure('dispatch-uncertain');return;}
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.byteLength;if(size>2*1024*1024)throw failure('invalid-run-list');chunks.push(chunk);}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!Array.isArray(value.workflow_runs)||value.workflow_runs.length>20||value.workflow_runs.some(r=>!Number.isSafeInteger(r.id)||!['completed',...ACTIVE].includes(r.status)))throw failure('invalid-run-list');
    return value.workflow_runs;
  };
  const result={checkedAt:new Date(now).toISOString(),mode:apply?'automatic-recovery':'read-only'};
  try {
    const runs=await request('/runs?branch=main&per_page=20');
    Object.assign(result,amcRecoveryDecision(runs,now));
    if(!result.due)return {...result,ok:true};
    if(!apply)return {...result,ok:true,reason:'would-dispatch'};
    // A newer completed run can hide an old queued/waiting request. Every active
    // status must be readable and empty immediately before the one allowed POST.
    const checks=await Promise.allSettled(ACTIVE.map(status=>request(`/runs?branch=main&per_page=1&status=${status}`)));
    if(checks.some(r=>r.status==='rejected'))throw failure('active-inventory-unavailable');
    if(checks.some(r=>r.value.some(run=>ACTIVE.includes(run.status))))return {...result,ok:true,due:false,reason:'already-running'};
    await request('/dispatches',{ref:'main',inputs:{mode:'monthly',commit:'true'}});
    return {...result,ok:true,reason:'dispatched'};
  }catch(error){return {...result,ok:false,reason:result.due?'dispatch-failed':'check-failed',error:error.code||'transport-unavailable'};}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const apply=process.argv.includes('--apply');
  if(apply&&(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'))throw failure('main-actions-only');
  const report=await recoverAmcCapture({repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,apply});
  console.log(JSON.stringify(report));process.exitCode=report.ok?0:1;
}
