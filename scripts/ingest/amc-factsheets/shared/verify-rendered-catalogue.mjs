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
}
for(const options of [{status:503},{url:'https://other.test/'},{timeout:true},{content:''},{content:'x'.repeat(8_000_001)}]) {
  f=fixture(options);await assert.rejects(readHsbcCatalogue(f));f.verify();
}
f=fixture({refusal:{status:403,url:'https://unrelated.test/ad'}});await readHsbcCatalogue(f);f.verify();
console.log('PASS rendered catalogue: fixed public URL, standard browser defaults, refused access, navigation failures, bounded content and cleanup');
