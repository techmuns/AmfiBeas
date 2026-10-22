import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {amcRecoveryDecision,recoverAmcCapture} from './recover-amc-capture.mjs';
const now=Date.parse('2026-10-22T06:00:00Z'),iso=age=>new Date(now-age*60000).toISOString();
const run=(age,extra={})=>({id:1,status:'completed',conclusion:'failure',created_at:iso(age+7),updated_at:iso(age),display_title:'AMC holdings · monthly',...extra});
assert(amcRecoveryDecision([run(16)],now).due,'Partial coverage does not disable healthy-source checks');
assert(!amcRecoveryDecision([run(14)],now).due);
assert(amcRecoveryDecision([],now).due);
for(const status of ['queued','in_progress','waiting','requested','pending'])assert.equal(amcRecoveryDecision([run(1),run(120,{id:2,status})],now).reason,'already-running');
assert(amcRecoveryDecision([run(1,{display_title:'AMC holdings · scheme-benchmarks'}),run(20,{id:2})],now).due);
for(const field of ['created_at','updated_at'])for(const value of ['invalid',iso(-2)])assert.throws(()=>amcRecoveryDecision([run(20,{[field]:value})],now));
let mode='ok',posts=0;
const fetcher=async(url,options)=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.github.com');
  assert(u.pathname.startsWith('/repos/techmuns/AmfiBeas/actions/workflows/amc-factsheet-monthly.yml/'));
  assert.equal(options.headers.authorization,'Bearer fixture-only');assert.equal(options.redirect,'error');
  if(options.method==='POST'){
    posts++;assert.deepEqual(JSON.parse(options.body),{ref:'main',inputs:{mode:'monthly',commit:'true'}});
    if(mode==='lost-response')throw Error('Lost POST response');
    return new Response(null,{status:mode==='ambiguous'?503:204});
  }
  assert.equal(u.searchParams.get('branch'),'main');const status=u.searchParams.get('status');
  if(mode==='unreadable'&&status==='waiting')return new Response(null,{status:403});
  if(mode==='invalid')return Response.json({message:'not a runs list'});
  return Response.json({workflow_runs:status?mode==='old-active'&&status==='waiting'?[run(120,{status})]:[]:[run(mode==='recent'?1:120)]});
};
const opts={token:'fixture-only',fetcher,now};
let report=await recoverAmcCapture(opts);assert.equal(report.reason,'would-dispatch');assert.equal(posts,0);
report=await recoverAmcCapture({...opts,apply:true});assert.equal(report.reason,'dispatched');assert.equal(posts,1);
for(const test of ['recent','old-active','unreadable','invalid']){
  mode=test;posts=0;report=await recoverAmcCapture({...opts,apply:true});assert.equal(posts,0,test);
  assert.equal(report.ok,['recent','old-active'].includes(test));
}
mode='ambiguous';posts=0;report=await recoverAmcCapture({...opts,apply:true});assert.equal(posts,1);assert.equal(report.error,'dispatch-uncertain');
mode='lost-response';posts=0;report=await recoverAmcCapture({...opts,apply:true});assert.equal(posts,1);assert.equal(report.error,'dispatch-uncertain');
await assert.rejects(recoverAmcCapture({...opts,repository:'other/repo'}));
const workflow=readFileSync(new URL('../.github/workflows/amc-capture-recovery.yml',import.meta.url),'utf8');
assert.match(workflow,/ref: main/);assert.match(workflow,/actions: write/);assert.match(workflow,/head_repository.full_name == github.repository/);
assert(!/secrets\.|wrangler|cancel-in-progress: true/.test(workflow));
assert.match(workflow,/timeout-minutes: 20/);assert.match(workflow,/node scripts\/continue-amc-recovery.mjs --apply/);
await import('./verify-amc-continuation.mjs');
console.log('PASS repository-owned AMC recovery: missing schedules, partial runs, benchmark separation, every active status, failed/ambiguous requests and fixed main-branch scope');
