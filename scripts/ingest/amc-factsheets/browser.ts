/**
 * Shared headless-Chromium launcher for the AMC portfolio fallback.
 *
 * Many AMCs host their monthly disclosure behind bot protection (Akamai returns
 * 403 to curl — HDFC, Edelweiss) or only reveal the file links after client-side
 * JS runs (Mirae, Bandhan, …). A real browser clears both: it presents a genuine
 * TLS/JS fingerprint and executes the page. This is the same tool the primary
 * holdings source (holdings-tracker.ts) already relies on.
 *
 * Two environments must both work from one config:
 *  - CI runner (open internet): default Playwright chromium, modern TLS.
 *  - Dev sandbox: all egress goes through a TLS-re-terminating proxy that can't
 *    MITM TLS 1.3 / Encrypted Client Hello, so Chromium's handshake is RST unless
 *    we force TLS 1.2 and disable ECH. We also point at the pre-installed browser
 *    (a fixed build under /opt/pw-browsers) since `playwright install` is blocked.
 * Both accommodations key off whether an HTTPS proxy is configured, so CI stays
 * on modern defaults.
 */

import fs from "node:fs";
import { chromium, type Browser, type BrowserContext } from "playwright";

const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium";
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || null;

/** Fallback UA when the browser version can't be read; the real UA is derived
 *  from the launched browser's version so Chrome's Sec-CH-UA client hints (which
 *  Playwright generates FROM this string) never contradict it — a version
 *  mismatch there is a classic bot-wall tell. */
export let UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function launchBrowser(): Promise<Browser> {
  const args = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    // Drop navigator.webdriver — the first thing every bot wall checks.
    "--disable-blink-features=AutomationControlled",
  ];
  if (PROXY) {
    // Dev-sandbox proxy can only MITM TLS 1.2 — see file header.
    args.push("--disable-features=EncryptedClientHello", "--ssl-version-max=tls1.2");
  }
  const sandboxExe = fs.existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined;
  const browser = await chromium.launch({
    headless: true,
    // Use the sandbox's pre-installed browser when present; on CI run the full
    // Chrome build in new-headless mode (channel "chromium") instead of the
    // stripped chrome-headless-shell — its fingerprint (fonts, canvas, speech,
    // codecs) is what Akamai-class walls probe.
    executablePath: sandboxExe,
    channel: sandboxExe ? undefined : "chromium",
    proxy: PROXY ? { server: PROXY } : undefined,
    args,
  });
  // Align the claimed Chrome version with the binary actually running.
  const major = browser.version().split(".")[0];
  if (/^\d+$/.test(major)) {
    UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  }
  return browser;
}

export async function newContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    userAgent: UA,
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    // A believable interactive-session shape: Indian locale + timezone (these
    // are Indian AMC sites; a US-datacenter default is another wall signal)
    // and a common desktop viewport instead of Playwright's 1280×720 default.
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: { "Accept-Language": "en-IN,en;q=0.9" },
  });
  // Belt-and-braces alongside the launch arg: some Chromium builds still expose
  // navigator.webdriver=false only via this override.
  await ctx.addInitScript(
    "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });",
  );
  return ctx;
}
