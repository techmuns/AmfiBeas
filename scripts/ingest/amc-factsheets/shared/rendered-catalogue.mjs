// HSBC's public information library is readable with ordinary Chromium in the
// hosted collector, while raw HTTP catalogue transfers repeatedly time out.
// Render this fixed public page only. No profile, credentials, identity changes,
// proxy, certificate overrides or challenge handling are used.
export const HSBC_CATALOGUE='https://www.assetmanagement.hsbc.co.in/en/mutual-funds/investor-resources/information-library';

export async function readHsbcCatalogue({chromium}={}) {
  chromium??=(await import('playwright')).chromium;
  const browser=await chromium.launch();
  try {
    const context=await browser.newContext(),page=await context.newPage();let refused=null;
    page.on('response',response=>{
      if(new URL(response.url()).origin===new URL(HSBC_CATALOGUE).origin&&[401,403,429].includes(response.status()))refused=response.status();
    });
    const check=()=>{if(refused)throw Object.assign(Error('Source refused access'),{code:'SOURCE_HTTP',status:refused});};
    const response=await page.goto(HSBC_CATALOGUE,{waitUntil:'domcontentloaded',timeout:30000});check();
    if(response?.status()!==200||page.url()!==HSBC_CATALOGUE)throw Error('Public catalogue unavailable');
    await page.locator('a[href*="/mutual-funds/portfolios/document-"]').first().waitFor({state:'attached',timeout:10000});check();
    const content=Buffer.from(await page.content());check();
    if(!content.length||content.length>8_000_000)throw Error('Invalid catalogue size');
    return content;
  }finally {await browser.close();}
}
