const classifyBrowserError=error=>{
  if(error?.name==='TimeoutError')return Object.assign(Error('Public catalogue timeout'),{code:'SOURCE_TRANSPORT',phase:'catalogue-navigation'});
  if(/Executable doesn't exist/.test(String(error?.message||'')))return Object.assign(Error('Collector browser unavailable'),{code:'COLLECTOR_DEPENDENCY'});
  if(/ERR_CERT_/.test(String(error?.message||'')))return Object.assign(Error('Public catalogue TLS failure'),{code:'SOURCE_TLS'});
  return error;
};
// HSBC's public information library is readable with ordinary Chromium in the
// hosted collector, while raw HTTP catalogue transfers repeatedly time out.
// Render this fixed public page only. No profile, credentials, identity changes,
// proxy, certificate overrides or challenge handling are used.
export const HSBC_CATALOGUE='https://www.assetmanagement.hsbc.co.in/en/mutual-funds/investor-resources/information-library';

export async function readHsbcCatalogue({chromium}={}) {
  chromium??=(await import('playwright')).chromium;
  let browser,refused=null;try{browser=await chromium.launch(...(process.env.MF_BROWSER_EXECUTABLE_PATH?[{executablePath:process.env.MF_BROWSER_EXECUTABLE_PATH}]:[]));}catch(error){throw classifyBrowserError(error);}
  try {
    const context=await browser.newContext(),page=await context.newPage();
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
  }catch(error){if(refused)throw Object.assign(Error('Source refused access'),{code:'SOURCE_HTTP',status:refused});throw classifyBrowserError(error);}finally {await browser.close();}
}

// HDFC initially serves older links, then hydrates the current catalogue. Read
// that published DOM in a fresh, ordinary browser; any refusal ends the attempt.
export const HDFC_CATALOGUE='https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio';
export async function readHdfcCatalogue({month,chromium}={}) {
  if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(month||''))throw Error('Invalid disclosure month');
  chromium??=(await import('playwright')).chromium;
  let browser,refused=null;try{browser=await chromium.launch(...(process.env.MF_BROWSER_EXECUTABLE_PATH?[{executablePath:process.env.MF_BROWSER_EXECUTABLE_PATH}]:[]));}catch(error){throw classifyBrowserError(error);}
  try {
    const context=await browser.newContext(),page=await context.newPage();
    page.on('response',response=>{
      if(['https://www.hdfcfund.com','https://files.hdfcfund.com'].includes(new URL(response.url()).origin)&&[401,403,429].includes(response.status()))refused=response.status();
    });
    const check=()=>{if(refused)throw Object.assign(Error('Source refused access'),{code:'SOURCE_HTTP',status:refused});};
    const response=await page.goto(HDFC_CATALOGUE,{waitUntil:'domcontentloaded',timeout:30000});check();
    if(response?.status()!==200||page.url()!==HDFC_CATALOGUE)throw Error('Public catalogue unavailable');
    const name=['January','February','March','April','May','June','July','August','September','October','November','December'][Number(month.slice(5))-1];
    await page.waitForFunction(({name,year})=>Array.from(document.querySelectorAll('a[href]')).some(a=>{
      try {const url=new URL(a.getAttribute('href'),location.href);return url.origin==='https://files.hdfcfund.com'&&decodeURIComponent(url.pathname).includes('Monthly HDFC')&&decodeURIComponent(url.pathname).includes(`${name} ${year}.xlsx`);}catch{return false;}
    }),{name,year:month.slice(0,4)},{timeout:15000});check();
    const content=Buffer.from(await page.content());check();
    if(!content.length||content.length>8_000_000)throw Error('Invalid catalogue size');
    return content;
  }catch(error){if(refused)throw Object.assign(Error('Source refused access'),{code:'SOURCE_HTTP',status:refused});throw classifyBrowserError(error);}finally {await browser.close();}
}
