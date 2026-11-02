// upload-wasabi.ts — Compatibility wrapper that forwards all uploads to Cloudflare R2 (upload-r2.ts).
//
// Per platform storage policy (SSOT), all release installers, manifests, and review screenshots
// are stored in Cloudflare R2 (zero egress fee) instead of Wasabi.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { upload, requireR2Env, loadR2EnvIfNeeded } from "./upload-r2.ts";

export { upload, requireR2Env, loadR2EnvIfNeeded };

const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const [localPath, key] = process.argv.slice(2);
  if (!localPath) {
    console.error("usage: upload-r2.ts <localPath> [key]");
    process.exit(2);
  }
  upload(localPath, { key })
    .then((url) => console.log(url))
    .catch((e) => {
      console.error(e.stack || String(e));
      process.exit(1);
    });
}
