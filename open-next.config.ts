// open-next.config.ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

/**
 * Serve every prerendered (force-static) page straight from the deployed
 * Workers ASSETS binding instead of re-rendering it on the Worker. Without an
 * incremental cache, OpenNext re-runs the full page render on a cold-isolate
 * cache-miss — and the heaviest pages (e.g. /monthly) blow the Cloudflare
 * Worker resource limit (Error 1102). The static-assets cache reads the
 * already-built HTML/RSC from the assets bundle, so a static page costs the
 * Worker almost nothing per request. No external infra (R2/KV) required.
 */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
