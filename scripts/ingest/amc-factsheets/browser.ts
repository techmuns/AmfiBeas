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

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function launchBrowser(): Promise<Browser> {
  const args = ["--no-sandbox", "--disable-dev-shm-usage"];
  if (PROXY) {
    // Dev-sandbox proxy can only MITM TLS 1.2 — see file header.
    args.push("--disable-features=EncryptedClientHello", "--ssl-version-max=tls1.2");
  }
  return chromium.launch({
    headless: true,
    // Use the sandbox's pre-installed browser when present; on CI let Playwright
    // resolve the version it installed itself.
    executablePath: fs.existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined,
    proxy: PROXY ? { server: PROXY } : undefined,
    args,
  });
}

export async function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ userAgent: UA, ignoreHTTPSErrors: true, acceptDownloads: true });
}
