// Staging diagnostics only. Standard Chromium defaults; no stealth configuration,
// private session, proxy, certificate override or challenge handling.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
const dir=process.env.MF_RENDERED_DIAGNOSTICS_DIR||path.join(os.tmpdir(),'amc-rendered-diagnostics');
fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch(),results=[];
try {
  for(const source of ['hdfc','jm-financial']) {
    const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
    page.setDefaultTimeout(15000);let refusal=null;
    page.on('response',response=>{
      const u=new URL(response.url());
      if((u.hostname.endsWith('.hdfcfund.com')||u.hostname.endsWith('.jmfinancialmf.com'))&&[401,403,429].includes(response.status()))refusal=response.status();
    });
    const check=()=>{if(refusal)throw Error(`Source refused access: ${refusal}`);};
    try {
      if(source==='hdfc') {
        await page.goto('https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio',{waitUntil:'domcontentloaded',timeout:30000});check();
        const links=page.locator('a[href*="files.hdfcfund.com"]').filter({hasText:/^Monthly HDFC/});
        await links.first().waitFor();check();
        const inventory=await links.evaluateAll(nodes=>nodes.map(a=>({text:a.textContent,url:a.href})));
        fs.writeFileSync(path.join(dir,'hdfc-links.json'),JSON.stringify(inventory,null,2));
        const pending=page.waitForEvent('download',{timeout:20000});
        await links.first().click();
        const download=await pending;check();
        await download.saveAs(path.join(dir,'hdfc-sample.xlsx'));
        results.push({source,status:'downloaded',catalogueLinks:inventory.length});
      } else {
        await page.goto('https://www.jmfinancialmf.com/downloads/Portfolio-Disclosure',{waitUntil:'domcontentloaded',timeout:30000});check();
        await page.getByLabel('Select sub category',{exact:true}).selectOption({label:'Monthly Portfolio of Schemes'});
        await page.getByLabel('Financial Year',{exact:true}).selectOption({label:'2026 - 2027'});check();
        const target=page.getByRole('link',{name:'View Monthly Portfolio- JM Overnight Fund - Aug 31, 2026 (08-Sep-2026)',exact:true});
        for(let i=0;i<4&&!await target.count();i++) {
          await page.getByText('Please Wait...',{exact:true}).waitFor({state:'hidden'});
          if(await target.count())break;
          await page.getByRole('button',{name:'Go to next page',exact:true}).click();check();
        }
        await target.waitFor();check();
        const pending=page.waitForEvent('download',{timeout:20000});await target.click();
        const download=await pending;check();await download.saveAs(path.join(dir,'jm-overnight-august.xlsx'));
        results.push({source,status:'downloaded'});
      }
    }catch(error) {results.push({source,status:'unavailable',reason:refusal?`HTTP ${refusal}`:String(error.name||'Error')});}
    finally {await context.close();fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(results,null,2));}
  }
}finally {await browser.close();}
console.log(JSON.stringify(results));
