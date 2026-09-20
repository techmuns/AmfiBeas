// Staging diagnostics only. Standard Chromium defaults; no stealth configuration,
// private session, proxy, certificate override or challenge handling.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
import {readHsbcCatalogue,HSBC_CATALOGUE} from './rendered-catalogue.mjs';
import {publicDisclosures} from './public-disclosures.mjs';
import {targetMonth} from './dates.mjs';
const dir=process.env.MF_RENDERED_DIAGNOSTICS_DIR||path.join(os.tmpdir(),'amc-rendered-diagnostics');
fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch(),results=[];
try {
  for(const source of ['whiteoak-capital','hdfc','hsbc','union','jm-financial']) {
    if(source==='hsbc') {
      try {
        const html=await readHsbcCatalogue({chromium});
        const links=await publicDisclosures('hsbc',targetMonth(),async url=>{if(url!==HSBC_CATALOGUE)throw Error('Unexpected catalogue URL');return html;},{includeHistory:true});
        fs.writeFileSync(path.join(dir,'hsbc-links.json'),JSON.stringify(links,null,2));
        results.push({source,status:'catalogue-readable',currentFiles:links.filter(l=>l.disclosureMonth===targetMonth()).length,filesWithHistory:links.length});
      }catch(error){results.push({source,status:'unavailable',reason:error.status?`HTTP ${error.status}`:String(error.name||'Error')});}
      fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(results,null,2));continue;
    }
    const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
    page.setDefaultTimeout(15000);let refusal=null;
    page.on('response',response=>{
      const u=new URL(response.url());
      if(['hdfcfund.com','jmfinancialmf.com','whiteoakamc.com','assetmanagement.hsbc.co.in','unionmf.com'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host))&&[401,403,429].includes(response.status()))refusal=response.status();
    });
    const check=()=>{if(refusal)throw Error(`Source refused access: ${refusal}`);};
    try {
      if(source==='whiteoak-capital') {
        const catalogue=page.waitForResponse(response=>response.url().startsWith('https://cms.whiteoakamc.com/api/scheme-portfolios?')&&new URL(response.url()).searchParams.get('filters[period][$eq]')==='monthly',{timeout:30000}).catch(()=>null);
        await page.goto('https://mf.whiteoakamc.com/regulatory-disclosures/scheme-portfolios',{waitUntil:'domcontentloaded',timeout:30000});check();
        await page.getByRole('radio',{name:'Monthly',exact:true}).check();check();
        const response=await catalogue;check();
        if(!response||response.status()!==200)throw Error('Monthly catalogue unavailable');
        const data=await response.json();
        fs.writeFileSync(path.join(dir,'whiteoak-monthly.json'),JSON.stringify(data,null,2));
        const pending=page.waitForEvent('download',{timeout:20000}).catch(()=>null);
        await page.getByRole('button',{name:/^Download WhiteOak.*Monthly Portfolio Disclosure/}).first().click();
        const download=await pending;check();
        if(!download)throw Error('No public download received');
        await download.saveAs(path.join(dir,'whiteoak-sample.xlsx'));
        results.push({source,status:'downloaded',catalogueRows:data.data?.length});
      } else if(source==='union') {
        await page.goto('https://www.unionmf.com/about-us/downloads',{waitUntil:'domcontentloaded',timeout:30000});check();
        const links=await page.locator('a[href]').evaluateAll(nodes=>nodes.filter(a=>/\.xlsx?(?:\?|$)/i.test(a.href)).map(a=>({text:a.textContent,url:a.href})));
        fs.writeFileSync(path.join(dir,source+'-links.json'),JSON.stringify(links,null,2));
        results.push({source,status:'page-readable',catalogueLinks:links.length});
      } else if(source==='hdfc') {
        await page.goto('https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio',{waitUntil:'domcontentloaded',timeout:30000});check();
        const links=page.locator('a[href*="files.hdfcfund.com"]').filter({hasText:/^Monthly HDFC/});
        await links.first().waitFor();check();
        const inventory=await links.evaluateAll(nodes=>nodes.map(a=>({text:a.textContent,url:a.href})));
        fs.writeFileSync(path.join(dir,'hdfc-links.json'),JSON.stringify(inventory,null,2));
        const pending=page.waitForEvent('download',{timeout:20000}).catch(()=>null);
        await links.first().click();
        const download=await pending;check();
        if(!download)throw Error('No public download received');
        await download.saveAs(path.join(dir,'hdfc-sample.xlsx'));
        results.push({source,status:'downloaded',catalogueLinks:inventory.length});
      } else {
        // Fixed regression sample, not a claim about the latest published month.
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
        const pending=page.waitForEvent('download',{timeout:20000}).catch(()=>null);await target.click();
        const download=await pending;check();
        if(!download)throw Error('No public download received');
        await download.saveAs(path.join(dir,'jm-overnight-august.xlsx'));
        results.push({source,status:'downloaded'});
      }
    }catch(error) {results.push({source,status:'unavailable',reason:refusal?`HTTP ${refusal}`:String(error.name||'Error')});}
    finally {await context.close();fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(results,null,2));}
  }
}finally {await browser.close();}
console.log(JSON.stringify(results));
