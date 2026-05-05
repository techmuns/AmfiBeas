import fs from "node:fs/promises";
import path from "node:path";

export const SNAPSHOT_DIR = path.resolve(
  process.cwd(),
  "src/data/snapshots"
);

export async function fetchText(url: string, timeoutMs = 60_000): Promise<string> {
  return (await fetchResponse(url, timeoutMs)).text();
}

export async function fetchBuffer(
  url: string,
  timeoutMs = 60_000
): Promise<ArrayBuffer> {
  return (await fetchResponse(url, timeoutMs)).arrayBuffer();
}

async function fetchResponse(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function writeSnapshot(name: string, data: unknown): Promise<void> {
  const file = path.join(SNAPSHOT_DIR, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function info(msg: string) {
  process.stdout.write(`[ingest] ${msg}\n`);
}

export function warn(msg: string) {
  process.stderr.write(`[ingest][warn] ${msg}\n`);
}
