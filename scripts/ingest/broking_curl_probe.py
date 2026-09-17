#!/usr/bin/env python3
"""
NSE reachability probe using curl_cffi (real-Chrome TLS/JA3 impersonation).

The Playwright probe hit NSE's Akamai defence: an HTTP/2 reset, then a hang on
HTTP/1.1. This tests the strongest free technique — impersonating a real
Chrome's TLS + HTTP/2 fingerprint — to decide, decisively, whether NSE is
blocking the *fingerprint* (beatable: curl_cffi gets 200s) or the GitHub-runner
*IP* itself (not beatable for free: everything 403s/times out from this IP).

No writes — this only prints status + a content preview for each candidate URL.
Run: pip install curl_cffi && python scripts/ingest/broking_curl_probe.py
"""
import sys

try:
    from curl_cffi import requests
except Exception as e:  # pragma: no cover
    print(f"curl_cffi import failed: {e}")
    sys.exit(1)

IMPERSONATE = "chrome"
HOME = "https://www.nseindia.com/"
# Candidate URLs: the member page, plausible JSON APIs, and the less-protected
# static archive host. We mainly want to know if ANY NSE host returns real 200s.
CANDIDATES = [
    ("home", HOME),
    ("members-page", "https://www.nseindia.com/market-data/exchange-wise-active-members"),
    ("api-exchange-wise", "https://www.nseindia.com/api/exchange-wise-active-members"),
    ("api-active-members", "https://www.nseindia.com/api/active-members"),
    ("all-reports-page", "https://www.nseindia.com/all-reports"),
    ("archives-root", "https://nsearchives.nseindia.com/"),
]


def main() -> None:
    print(f"curl_cffi probe — impersonate={IMPERSONATE}")
    session = requests.Session(impersonate=IMPERSONATE)
    # Warm cookies from the homepage first (Akamai sets them there).
    try:
        r0 = session.get(HOME, timeout=30)
        print(f"[warm] {HOME} -> {r0.status_code}, {len(r0.content)} bytes, "
              f"cookies={list(session.cookies.keys())}")
    except Exception as e:
        print(f"[warm] {HOME} -> EXCEPTION {type(e).__name__}: {e}")

    print("================ NSE CURL PROBE ================")
    any_ok = False
    for label, url in CANDIDATES:
        try:
            r = session.get(url, timeout=30)
            body = r.text or ""
            preview = body[:180].replace("\n", " ")
            ok = r.status_code == 200 and len(body) > 200
            any_ok = any_ok or ok
            print(f"[{'OK ' if ok else '   '}] {r.status_code} {label:18} {len(body):>8} B  {url}")
            print(f"        preview: {preview!r}")
        except Exception as e:
            print(f"[ERR] {label:18} {url} -> {type(e).__name__}: {e}")
    print("===============================================")
    if any_ok:
        print("RESULT: curl_cffi reached NSE (fingerprint block is beatable). "
              "Next: find the active-clients endpoint among the 200s / their XHRs.")
    else:
        print("RESULT: every NSE request failed from this runner IP. This is an "
              "IP-level block, not a fingerprint block — no free client-side "
              "technique will fetch NSE from GitHub Actions. Use the manual "
              "monthly CSV drop (auto-deploys) instead.")


if __name__ == "__main__":
    main()
