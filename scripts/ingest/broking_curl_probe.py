#!/usr/bin/env python3
"""
NSE endpoint DISCOVERY probe using curl_cffi (real-Chrome TLS impersonation).

curl_cffi reaches NSE where headless Chromium is blocked (confirmed: the
homepage and /all-reports return 200). This pass mines the reachable pages for
the active-clients-per-broker data endpoint: it warms cookies, fetches a set of
candidate pages/APIs, and for each one prints the status plus any API paths,
downloadable-file links (csv/xlsx/zip), and "active client / member" mentions it
finds — so the real endpoint can be pinned.

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

# Pages likely to reference the active-clients data or its API, plus direct API
# guesses. curl_cffi follows the same cookie jar across them.
PAGES = [
    "https://www.nseindia.com/all-reports",
    "https://www.nseindia.com/market-data/exchange-communication-circulars",
    "https://www.nseindia.com/reports-indices-sp-cnx-nifty",
    "https://www.nseindia.com/resources-membership",
]
API_GUESSES = [
    "https://www.nseindia.com/api/reports?archives=%5B%7B%22name%22%3A%22Active%20clients%22%2C%22type%22%3A%22archives%22%2C%22category%22%3A%22capital_market%22%2C%22section%22%3A%22equities%22%7D%5D&date=&type=equities&mode=single",
    "https://www.nseindia.com/api/merged-daily-reports?key=favCapital",
    "https://www.nseindia.com/api/allIndices",
]

API_RE = re.compile(r"/api/[A-Za-z0-9_\-/?=&%.:,{}\[\]\"]+")
FILE_RE = re.compile(r"https?://[^\s\"'<>]+\.(?:csv|xlsx|xls|zip)", re.I)
ARCHIVE_RE = re.compile(r"https?://nsearchives\.nseindia\.com[^\s\"'<>]+", re.I)
ACTIVE_RE = re.compile(r".{0,60}active\s*clients?.{0,60}", re.I)


def mine(label: str, url: str, session) -> None:
    try:
        r = session.get(url, timeout=30)
    except Exception as e:
        print(f"[ERR] {label:26} {url} -> {type(e).__name__}: {e}")
        return
    body = r.text or ""
    print(f"[{r.status_code}] {label:26} {len(body):>8} B  {url}")
    if r.status_code != 200 or len(body) < 200:
        print(f"        preview: {body[:160]!r}")
        return
    apis = sorted(set(m.group(0) for m in API_RE.finditer(body)))[:25]
    files = sorted(set(FILE_RE.findall(body) if False else (m.group(0) for m in FILE_RE.finditer(body))))[:15]
    archives = sorted(set(m.group(0) for m in ARCHIVE_RE.finditer(body)))[:15]
    actives = sorted(set(m.group(0).strip() for m in ACTIVE_RE.finditer(body)))[:8]
    if apis:
        print(f"        api paths ({len(apis)}): " + "; ".join(apis))
    if files:
        print(f"        file links: " + "; ".join(files))
    if archives:
        print(f"        archive links: " + "; ".join(archives))
    if actives:
        print(f"        'active client' hits:")
        for a in actives:
            print(f"          … {a!r}")
    if not (apis or files or archives or actives):
        print("        (no api/file/active-client references found)")


def main() -> None:
    print(f"curl_cffi discovery — impersonate={IMPERSONATE}")
    session = requests.Session(impersonate=IMPERSONATE)
    try:
        r0 = session.get(HOME, timeout=30)
        print(f"[warm] {HOME} -> {r0.status_code}, cookies={list(session.cookies.keys())}")
    except Exception as e:
        print(f"[warm] failed: {e}")
    print("================ NSE DISCOVERY ================")
    for url in PAGES:
        mine(url.rsplit("/", 1)[-1] or "root", url, session)
    print("---- direct API guesses ----")
    for url in API_GUESSES:
        try:
            r = session.get(url, timeout=30)
            body = r.text or ""
            print(f"[{r.status_code}] {'api-guess':26} {len(body):>8} B  {url[:90]}")
            print(f"        preview: {body[:220]!r}")
        except Exception as e:
            print(f"[ERR] api-guess {url[:80]} -> {type(e).__name__}: {e}")
    print("==============================================")


if __name__ == "__main__":
    main()
