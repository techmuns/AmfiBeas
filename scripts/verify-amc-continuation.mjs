import assert from 'node:assert/strict';
import {continueAmcRecovery} from './continue-amc-recovery.mjs';

const START=Date.parse('2026-10-22T06:00:00Z'),MINUTE=60000;
const sourcePath='/repos/techmuns/AmfiBeas/actions/workflows/amc-factsheet-monthly.yml';
const observerPath='/repos/techmuns/AmfiBeas/actions/workflows/amc-capture-recovery.yml';
function fixture(mode='overdue') {
  let clock=START;
  const calls=[],sleeps=[],reports=[];
  const completed=at=>({id:1,status:'completed',created_at:new Date(at-7*MINUTE).toISOString(),
    updated_at:new Date(at).toISOString(),display_title:'AMC holdings · monthly'});
  const fetcher=async(url,options)=>{
    const u=new URL(url);calls.push({path:u.pathname,method:options.method,at:clock});
    assert.equal(u.origin,'https://api.github.com');assert.equal(options.redirect,'error');
    assert.equal(options.headers.authorization,'Bearer fixture-only');
    if(options.method==='POST') {
      assert([sourcePath+'/dispatches',observerPath+'/dispatches'].includes(u.pathname));
      const observer=u.pathname===observerPath+'/dispatches';
      assert.deepEqual(JSON.parse(options.body),observer?{ref:'main'}:{ref:'main',inputs:{mode:'monthly',commit:'true'}});
      if(mode===(observer?'handoff-lost':'source-lost'))throw Error('Uncertain response');
      return new Response(null,{status:mode===(observer?'handoff-503':'source-503')?503:204});
    }
    assert.equal(u.pathname,sourcePath+'/runs');assert.equal(u.searchParams.get('branch'),'main');
    const status=u.searchParams.get('status');
    if(mode==='unreadable'&&status==='waiting')return new Response(null,{status:403});
    if(mode==='invalid')return Response.json({workflow_runs:[{id:1,status:'unrecognised'}]});
    let run=completed(mode==='recent'?START-14*MINUTE:START-60*MINUTE);
    if(mode==='completes-later')run=clock<START+4*MINUTE?
      {...completed(START),status:'in_progress'}:completed(START+4*MINUTE);
    if(mode==='active')run={...run,status:'waiting'};
    if(mode==='late-active'&&status==='waiting')run={...run,status:'waiting'};
    return Response.json({workflow_runs:status?run.status===status?[run]:[]:[run]});
  };
  const options={token:'fixture-only',fetcher,now:()=>clock,
    wait:async ms=>{assert(ms>0&&ms<=12*MINUTE);sleeps.push(ms);clock+=ms;},
    onCheck:r=>reports.push(r),apply:true};
  return {options,calls,sleeps,reports,clock:()=>clock,
    sourcePosts:()=>calls.filter(c=>c.path===sourcePath+'/dispatches'),
    handoffs:()=>calls.filter(c=>c.path===observerPath+'/dispatches')};
}

// Every observer establishes exactly one durable handoff before source writes.
for(const mode of ['overdue','recent']) {
  const f=fixture(mode),report=await continueAmcRecovery(f.options);
  assert.equal(report.reason,'dispatched');assert.equal(report.continuation,'queued');
  assert.equal(f.handoffs().length,1);assert.equal(f.sourcePosts().length,1);
  assert.equal(f.calls[0].path,observerPath+'/dispatches');
  assert.equal(f.sourcePosts()[0].at,START+(mode==='recent'?MINUTE:0));
  assert.equal(f.clock(),START+12*MINUTE,'A successor cannot spin immediately after dispatch');
}

// A bot collector completing while watched still gets the full 15-minute
// cooldown, including across an observer handoff; workflow_run is not needed.
const completing=fixture('completes-later');
let report=await continueAmcRecovery(completing.options);
assert.equal(report.reason,'recent-run');assert.equal(completing.sourcePosts().length,0);
report=await continueAmcRecovery(completing.options);
assert.equal(report.reason,'dispatched');assert.equal(completing.handoffs().length,2);
assert.equal(completing.sourcePosts().length,1);assert.equal(completing.sourcePosts()[0].at,START+19*MINUTE);
assert.equal(completing.clock(),START+24*MINUTE);

for(const mode of ['active','late-active','unreadable','invalid']) {
  const f=fixture(mode),report=await continueAmcRecovery(f.options);
  assert.equal(f.handoffs().length,1);assert.equal(f.sourcePosts().length,0,mode);
  assert.equal(f.clock(),START+12*MINUTE);assert.equal(report.ok,['active','late-active'].includes(mode));
  assert(f.calls.length<100,'Bounded, once-per-minute observations');
}
for(const mode of ['source-lost','source-503']) {
  const f=fixture(mode),report=await continueAmcRecovery(f.options);
  assert.equal(report.ok,false);assert.equal(report.error,'dispatch-uncertain');
  assert.equal(f.handoffs().length,1);assert.equal(f.sourcePosts().length,1,'Never blindly retry an uncertain source POST');
  assert.equal(f.clock(),START+12*MINUTE);assert.equal(f.reports.length,1);
}
for(const mode of ['handoff-lost','handoff-503']) {
  const f=fixture(mode),report=await continueAmcRecovery(f.options);
  assert.equal(report.ok,false);assert.equal(report.error,'continuation-dispatch-uncertain');
  assert.equal(f.handoffs().length,1);assert.equal(f.sourcePosts().length,0,'Unconfirmed handoff cannot start a source run');
  assert.equal(f.clock(),START+12*MINUTE);
}
const readOnly=fixture();report=await continueAmcRecovery({...readOnly.options,apply:false});
assert.equal(report.reason,'would-dispatch');assert.equal(readOnly.handoffs().length,0);
assert.equal(readOnly.sourcePosts().length,0);assert.equal(readOnly.sleeps.length,0);
for(const options of [{repository:'other/repo'},{budgetMs:13*MINUTE},{budgetMs:0},{token:''}]) {
  const f=fixture();await assert.rejects(continueAmcRecovery({...f.options,...options}),/configuration/);
  assert.equal(f.calls.length,0);
}
console.log('PASS bounded AMC continuation: own fixed workflow, durable handoff, completion cooldown across observers, active-run exclusion, read-only mode and uncertain-dispatch backoff');
