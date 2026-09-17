#!/usr/bin/env python3
"""
NSE report-catalog discovery via curl_cffi (real-Chrome TLS impersonation).

curl_cffi reaches NSE's API (confirmed: /api/merged-daily-reports and
/api/reports respond). This pass hunts the exact "active clients per member"
report descriptor two ways:

  1. Mine the /all-reports Next.js JS bundle — the report tree (names, keys,
     archive descriptors) is defined there — for anything matching
     active / client / member.
  2. Enumerate /api/merged-daily-reports?key=<K> for the known report groups and
     print the report names each returns, so we can see which group (if any)
     carries active clients and its `link`.

No writes. Run: pip install curl_cffi && python scripts/ingest/broking_curl_probe.py
"""
import re
import sys

try:
    from curl_cffi import requests
except Exception as e:  # pragma: no cover
    print(f"curl_cffi import failed: {e}")
    sys.exit(1)

IMPERSONATE = "chrome"
HOME = "https://www.nseindia.com/"
ALL_REPORTS = "https://www.nseindia.com/all-reports"

# merged-daily-reports report-group keys to enumerate (NSE segments).
KEYS = [
    "favCapital", "favDerivatives", "favDebt", "favCurrency", "favCommodity",
    "favSLBS", "favMF", "favInvest", "favEmerge", "favMonthly", "favMember",
    "favMembership", "favTradeStatistics", "favBusinessGrowth",
]

KW = re.compile(r"active[\s_\-]*clients?", re.I)
SCRIPT_RE = re.compile(r'src="(/_next/[^"]+\.js)"')
STR_RE = re.compile(r'["\']([^"\']{0,80}?active[\s_\-]*clients?[^"\']{0,80}?)["\']', re.I)


def get(session, url, **kw):
    try:
        return session.get(url, timeout=30, **kw)
    except Exception as e:
        print(f"[ERR] {url[:90]} -> {type(e).__name__}: {e}")
        return None


def main() -> None:
    print(f"curl_cffi catalog discovery — impersonate={IMPERSONATE}")
    session = requests.Session(impersonate=IMPERSONATE)
    r0 = get(session, HOME)
    print(f"[warm] home -> {r0.status_code if r0 else 'ERR'}")

    # ---- 1. mine the all-reports JS bundle ---------------------------------
    print("================ JS BUNDLE MINE ================")
    r = get(session, ALL_REPORTS)
    scripts = sorted(set(SCRIPT_RE.findall(r.text))) if r and r.status_code == 200 else []
    print(f"/all-reports -> {r.status_code if r else 'ERR'}, {len(scripts)} _next scripts")
    hits = 0
    for path in scripts[:30]:
        url = "https://www.nseindia.com" + path
        jr = get(session, url)
        if not jr or jr.status_code != 200:
            continue
        found = sorted(set(m.group(1).strip() for m in STR_RE.finditer(jr.text)))
        if found:
            print(f"  [{path.rsplit('/',1)[-1]}] active-clients strings:")
            for f in found[:12]:
                print(f"      {f!r}")
            hits += len(found)
        # also surface any nearby report keys / api paths in the same chunk
        if KW.search(jr.text):
            apis = sorted(set(re.findall(r"/api/[A-Za-z0-9_\-]+", jr.text)))[:20]
            if apis:
                print(f"      ({path.rsplit('/',1)[-1]} api paths: {', '.join(apis)})")
    if not hits:
        print("  (no active-clients strings in JS bundle)")

    # ---- 2. enumerate report-group catalogs --------------------------------
    print("================ REPORT-GROUP KEYS ================")
    for key in KEYS:
        jr = get(session, f"https://www.nseindia.com/api/merged-daily-reports?key={key}")
        if not jr:
            continue
        body = jr.text or ""
        names = re.findall(r'"name"\s*:\s*"([^"]+)"', body)
        active = [n for n in names if KW.search(n)]
        flag = "  <<< ACTIVE-CLIENTS" if active else ""
        print(f"  key={key:20} {jr.status_code} {len(body):>7}B  {len(names)} reports{flag}")
        if active:
            for n in active:
                # print the full object for the matching report
                m = re.search(r'\{[^{}]*"name"\s*:\s*"' + re.escape(n) + r'"[^{}]*\}', body)
                print(f"      {m.group(0) if m else n}")
    print("==================================================")


if __name__ == "__main__":
    main()
