import assert from 'node:assert/strict';
import {HSBC_CATALOGUE,readHsbcCatalogue} from './rendered-catalogue.mjs';

function fixture({status=200,url=HSBC_CATALOGUE,refusal,timeout=false,content='<a href="/mutual-funds/portfolios/document-31082026/fund.xlsx">Monthly</a>'}={}) {
  let listener,closed=0;const calls=[];
  const page={
    on(event,callback){assert.equal(event,'response');listener=callback;},
    async goto(target,options){
      calls.push(target);assert.equal(target,HSBC_CATALOGUE);assert.equal(options.timeout,30000);
      if(refusal)listener({url:()=>refusal.url||HSBC_CATALOGUE,status:()=>refusal.status});
      if(timeout)throw Object.assign(Error('Navigation timeout'),{name:'TimeoutError'});
      return {status:()=>status};
    },
    url:()=>url,
    locator(selector){assert.equal(selector,'a[href*="/mutual-funds/portfolios/document-"]');return {first:()=>({waitFor:async options=>assert.deepEqual(options,{state:'attached',timeout:10000})})};},
    content:async()=>content,
  };
  return {
    chromium:{async launch(...args){assert.equal(args.length,0,'Browser identity and launch defaults are unchanged');return {
      async newContext(...args){assert.equal(args.length,0,'No existing profile or credentials');return {newPage:async()=>page};},
      close:async()=>closed++,
    };}},
    verify(){assert.equal(closed,1,'Every exit closes the browser');assert.deepEqual(calls,[HSBC_CATALOGUE]);},
  };
}
let f=fixture();assert.match((await readHsbcCatalogue(f)).toString(),/Monthly/);f.verify();
for(const status of [401,403,429]) {
  f=fixture({refusal:{status}});await assert.rejects(readHsbcCatalogue(f),e=>e.code==='SOURCE_HTTP'&&e.status===status);f.verify();
  f=fixture({refusal:{status},timeout:true});await assert.rejects(readHsbcCatalogue(f),e=>e.code==='SOURCE_HTTP'&&e.status===status,'An observed refusal takes precedence over a later navigation timeout');f.verify();
}
for(const options of [{status:503},{url:'https://other.test/'},{timeout:true},{content:''},{content:'x'.repeat(8_000_001)}]) {
  f=fixture(options);await assert.rejects(readHsbcCatalogue(f));f.verify();
}
f=fixture({refusal:{status:403,url:'https://unrelated.test/ad'}});await readHsbcCatalogue(f);f.verify();
console.log('PASS rendered catalogue: fixed public URL, standard browser defaults, refused access, navigation failures, bounded content and cleanup');
const {HDFC_CATALOGUE,readHdfcCatalogue}=await import('./rendered-catalogue.mjs');
let waited=false,closed=0;
const hdfcPage={on(){},async goto(url){assert.equal(url,HDFC_CATALOGUE);return{status:()=>200};},url:()=>HDFC_CATALOGUE,
 async waitForFunction(fn,args,options){assert.equal(args.name,'September');assert.equal(args.year,'2026');assert.equal(options.timeout,15000);assert.match(fn.toString(),/Monthly HDFC/);waited=true;},
 async content(){assert(waited,'Wait for the requested period before reading initially stale DOM');return '<a href="https://files.hdfcfund.com/2026/Monthly%20HDFC%20Value%20Fund%20-%2030%20September%202026.xlsx?VersionId=fixture">Monthly</a>';}};
const rendered=await readHdfcCatalogue({month:'2026-09',chromium:{launch:async()=>({newContext:async()=>({newPage:async()=>hdfcPage}),close:async()=>closed++})}});
assert.match(rendered.toString(),/VersionId=fixture/);assert.equal(closed,1);
console.log('PASS HDFC hydration: requested period wait, fixed official catalogue and exact versioned file links');
