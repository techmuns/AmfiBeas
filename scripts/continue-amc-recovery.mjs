import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {recoverAmcCapture} from './recover-amc-capture.mjs';

const REPO='techmuns/AmfiBeas';
const CONTINUATION=`https://api.github.com/repos/${REPO}/actions/workflows/amc-capture-recovery.yml/dispatches`;
const BUDGET_MS=12*60000, POLL_MS=60000;
const failure=code=>Object.assign(Error(code),{code});

// workflow_dispatch is explicitly allowed with GITHUB_TOKEN. Do not rely on a
// bot-started collector producing another workflow_run, or on punctual cron.
// The existing workflow concurrency group holds this one successor pending.
async function queueContinuation(token,fetcher) {
  let response;
  try {
    response=await fetcher(CONTINUATION,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{accept:'application/vnd.github+json','x-github-api-version':'2022-11-28',
        authorization:`Bearer ${token}`,'user-agent':'amfi-capture-recovery','content-type':'application/json'},
      body:JSON.stringify({ref:'main'})
    });
  }catch {throw failure('continuation-dispatch-uncertain');}
  await response.body?.cancel();
  if(response.status!==204)throw failure(response.status>=500||response.ok?
    'continuation-dispatch-uncertain':`continuation-github-${response.status}`);
}

export async function continueAmcRecovery({repository=REPO,token,fetcher=fetch,
  now=Date.now,wait=sleep,budgetMs=BUDGET_MS,apply=false,onCheck=()=>{}}={}) {
  if(repository!==REPO||!token||!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>BUDGET_MS)throw failure('configuration');
  const started=now();
  if(!Number.isFinite(started))throw failure('invalid-clock');
  const deadline=started+budgetMs;
  const check=()=>recoverAmcCapture({repository,token,fetcher,now:now(),apply});
  // Read-only inspection stays immediate and never queues or starts any job.
  if(!apply)return recoverAmcCapture({repository,token,fetcher,now:started});
  let queued=false,report;
  try {
    // Persist the handoff before waiting or starting a source run, so a later
    // collector failure cannot silently terminate the refresh chain.
    await queueContinuation(token,fetcher);queued=true;
    while(now()<deadline) {
      report=await check();onCheck(report);
      if(!report.ok||report.reason==='dispatched')break;
      const dueAt=Date.parse(report.nextCheckAt);
      const delay=Number.isFinite(dueAt)&&dueAt>now()?Math.min(POLL_MS,dueAt-now()):POLL_MS;
      await wait(Math.min(delay,Math.max(0,deadline-now())));
    }
    return {...report,ok:report?.ok??true,continuation:'queued'};
  }catch(error) {
    return {...report,ok:false,continuation:queued?'queued':'unconfirmed',error:error.code||'continuation-failed'};
  }finally {
    // Keep the successor pending for the bounded observation window, including
    // ambiguous POST responses. Never retry a source dispatch in this observer;
    // its successor must read the actual run inventory and the 15-minute gate.
    const remaining=deadline-now();
    if(remaining>0)await wait(remaining);
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const apply=process.argv.includes('--apply');
  if(apply&&(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'))throw failure('main-actions-only');
  const report=await continueAmcRecovery({repository:process.env.GITHUB_REPOSITORY,
    token:process.env.GITHUB_TOKEN,apply,onCheck:value=>console.log(JSON.stringify(value))});
  console.log(JSON.stringify(report));process.exitCode=report.ok?0:1;
}
