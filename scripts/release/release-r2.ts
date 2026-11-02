#!/usr/bin/env node
/**
 * release-r2.ts — 버전업 셋업(.exe/.dmg) 빌드 및 Cloudflare R2 업로드 자동화 스크립트.
 *
 * 사용법:
 *   node scripts/release/release-r2.ts --dry-run
 *   node scripts/release/release-r2.ts --build --upload
 *   node scripts/release/release-r2.ts --bump --build --upload
 *   node scripts/release/release-r2.ts --upload [--installer <path>] [--prefix <r2-prefix>]
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireR2Env, upload } from "../loop/upload-r2.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = existsSync(resolve(HERE, "../../package.json"))
  ? resolve(HERE, "../..")
  : process.cwd();

export interface ReleaseR2Options {
  cwd?: string;
  bump?: boolean;
  build?: boolean;
  uploadToR2?: boolean;
  dryRun?: boolean;
  installerPath?: string;
  prefix?: string;
  version?: string;
  notes?: string;
}

export interface ReleaseManifest {
  app: string;
  version: string;
  platform: string;
  releaseDate: string;
  publishedAt: string;
  url: string;
  installer_url: string;
  checksum_url: string;
  sha256: string;
  size: number;
  sizeBytes: number;
  notes: string;
  releaseNotes: string;
}

export interface ReleaseResult {
  appSlug: string;
  version: string;
  installerPath: string;
  installerName: string;
  sha256: string;
  size: number;
  installerUrl: string;
  manifestUrl: string;
  manifest: ReleaseManifest;
  uploaded: boolean;
}

export function computeSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function detectProjectInfo(root = DEFAULT_ROOT): { appSlug: string; appName: string; version: string } {
  let appSlug = basename(resolve(root));
  let appName = appSlug;
  let version = "0.1.0";

  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (typeof pkg.name === "string" && pkg.name.trim()) {
        appSlug = pkg.name.replace(/^@[^/]+\//, "").trim();
        appName = appSlug;
      }
      if (typeof pkg.version === "string" && /^\d+\.\d+\.\d+/.test(pkg.version)) {
        version = pkg.version.trim();
      }
    } catch {
      // ignore
    }
  }

  const versionFile = join(root, "VERSION");
  if (existsSync(versionFile)) {
    try {
      const v = readFileSync(versionFile, "utf8").trim().replace(/^v/, "");
      if (/^\d+\.\d+\.\d+/.test(v)) version = v;
    } catch {
      // ignore
    }
  }

  const wailsPath = join(root, "wails.json");
  if (existsSync(wailsPath)) {
    try {
      const wails = JSON.parse(readFileSync(wailsPath, "utf8"));
      if (wails.info?.productVersion && /^\d+\.\d+\.\d+/.test(wails.info.productVersion)) {
        version = wails.info.productVersion;
      }
      if (wails.info?.productName) {
        appName = wails.info.productName;
      }
    } catch {
      // ignore
    }
  }

  return { appSlug, appName, version };
}

export function bumpProjectVersion(root = DEFAULT_ROOT): string {
  const versionSyncScript = [
    join(root, "scripts", "loop", "version-sync.ts"),
    join(root, "template", "scripts", "loop", "version-sync.ts"),
  ].find((p) => existsSync(p));

  if (versionSyncScript) {
    const res = spawnSync(process.execPath, [versionSyncScript, "bump"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    if (res.status === 0) {
      return detectProjectInfo(root).version;
    }
  }

  const info = detectProjectInfo(root);
  const parts = info.version.split(".").map((n) => Number(n) || 0);
  const nextVersion = `${parts[0] ?? 0}.${parts[1] ?? 0}.${(parts[2] ?? 0) + 1}`;

  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.version = nextVersion;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  }

  const versionFile = join(root, "VERSION");
  if (existsSync(versionFile)) {
    writeFileSync(versionFile, `${nextVersion}\n`, "utf8");
  }

  return nextVersion;
}

export function findSetupInstaller(root: string, appSlug: string, version: string): string | null {
  const exactCandidates = [
    join(root, "dist", `${appSlug}-setup-v${version}.exe`),
    join(root, "dist", `${appSlug}-setup-v${version}-win-x64.exe`),
    join(root, "exports", `${appSlug}-setup-v${version}.exe`),
    join(root, "exports", `${appSlug}-setup-v${version}-win-x64.exe`),
    join(root, "dist", "release", `${appSlug}-setup-v${version}.exe`),
    join(root, "build", "bin", `${appSlug}-v${version}-setup.exe`),
    join(root, "build", "bin", `${appSlug}-setup-v${version}.exe`),
    join(root, "build", "bin", `${appSlug}-amd64-installer.exe`),
  ];

  for (const c of exactCandidates) {
    if (existsSync(c)) return c;
  }

  const searchDirs = [
    join(root, "dist"),
    join(root, "exports"),
    join(root, "dist", "release"),
    join(root, "build", "bin"),
  ];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir)
        .filter((f) => /\.(exe|dmg|msi)$/i.test(f) && (f.includes(version) || /setup|installer/i.test(f)))
        .map((f) => join(dir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      if (files.length > 0) return files[0]!;
    } catch {
      // ignore
    }
  }

  return null;
}

export function runSetupBuild(root = DEFAULT_ROOT, version?: string): string {
  const { appSlug, version: detectedVersion } = detectProjectInfo(root);
  const targetVersion = version || detectedVersion;

  const psScripts = [
    join(root, "scripts", "release", "build-setup.ps1"),
    join(root, "scripts", "build-setup.ps1"),
    join(root, "scripts", "build-installer.ps1"),
    join(root, "scripts", "build-release.ps1"),
    join(root, "scripts", "release.ps1"),
  ];

  const foundPs = psScripts.find((p) => existsSync(p));
  if (foundPs && process.platform === "win32") {
    const shell = spawnSync("pwsh", ["-v"], { windowsHide: true }).status === 0 ? "pwsh" : "powershell";
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", foundPs];
    if (foundPs.endsWith("build-setup.ps1")) {
      args.push("-Version", targetVersion, "-SkipUpload");
    }
    const res = spawnSync(shell, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    if (res.status !== 0) {
      throw new Error(`Setup build script failed (${basename(foundPs)}, exit ${res.status})`);
    }
  }

  const built = findSetupInstaller(root, appSlug, targetVersion);
  if (!built) {
    throw new Error(`Setup installer not found for ${appSlug} v${targetVersion} after build.`);
  }
  return built;
}

export async function releaseToR2(options: ReleaseR2Options = {}): Promise<ReleaseResult> {
  const root = resolve(options.cwd || DEFAULT_ROOT);
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.name === "@neohum77/create-agent-harness") {
        throw new Error(
          "create-agent-harness 자체는 GitHub로만 배포합니다. 셋업 파일을 만드는 대상 프로젝트에서만 실행하세요.",
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("GitHub로만 배포합니다")) throw err;
    }
  }

  if (options.bump) {
    const bumped = bumpProjectVersion(root);
    console.log(`✓ Version synchronized: v${bumped}`);
  }

  const info = detectProjectInfo(root);
  const version = options.version || info.version;
  const appSlug = options.prefix || info.appSlug;

  let installerPath = options.installerPath ? resolve(root, options.installerPath) : null;
  if (options.build || (!installerPath && !findSetupInstaller(root, info.appSlug, version))) {
    if (options.build) {
      console.log(`🔨 Building setup installer for ${info.appSlug} v${version}...`);
      installerPath = runSetupBuild(root, version);
    }
  }

  if (!installerPath) {
    installerPath = findSetupInstaller(root, info.appSlug, version);
  }
  if (!installerPath || !existsSync(installerPath)) {
    throw new Error(
      `Setup file not found for ${info.appSlug} v${version}. Run with --build or pass --installer <path>.`,
    );
  }

  const outDir = dirname(installerPath);
  mkdirSync(outDir, { recursive: true });

  const canonicalSetupName = `${info.appSlug}-setup-v${version}.exe`;
  const canonicalSetupPath = join(outDir, canonicalSetupName);
  if (resolve(installerPath) !== resolve(canonicalSetupPath) && installerPath.toLowerCase().endsWith(".exe")) {
    copyFileSync(installerPath, canonicalSetupPath);
  }

  const primaryPath = existsSync(canonicalSetupPath) ? canonicalSetupPath : installerPath;
  const installerName = basename(primaryPath);
  const sha256 = computeSha256(primaryPath);
  const size = statSync(primaryPath).size;

  const checksumPath = `${primaryPath}.sha256`;
  writeFileSync(checksumPath, `${sha256}  ${installerName}\n`, "utf8");

  let endpoint = "https://9d5d05a9b5b1b7fde0163c4d83849cab.r2.cloudflarestorage.com";
  let bucket = process.env.R2_BUCKET || "edulinker-download";
  try {
    const cfg = requireR2Env();
    endpoint = cfg.endpoint;
    bucket = cfg.bucket;
  } catch (err) {
    if (!options.dryRun && options.uploadToR2) throw err;
  }

  const publicCdn = process.env.R2_PUBLIC_CDN_URL?.replace(/\/+$/, "");
  const baseObjectUrl = publicCdn ? `${publicCdn}/${appSlug}` : `${endpoint}/${bucket}/${appSlug}`;

  const installerKey = `${appSlug}/${installerName}`;
  const checksumKey = `${appSlug}/${installerName}.sha256`;
  const latestWinKey = `${appSlug}/latest-win.json`;
  const latestKey = `${appSlug}/latest.json`;

  const installerUrl = `${baseObjectUrl}/${installerName}`;
  const checksumUrl = `${baseObjectUrl}/${installerName}.sha256`;
  const manifestUrl = `${baseObjectUrl}/latest.json`;
  const now = new Date().toISOString();
  const notes = options.notes || process.env.RELEASE_NOTES || `${info.appName} v${version} Setup Release (Cloudflare R2)`;

  const manifest: ReleaseManifest = {
    app: info.appName,
    version,
    platform: "win",
    releaseDate: now,
    publishedAt: now,
    url: installerUrl,
    installer_url: installerUrl,
    checksum_url: checksumUrl,
    sha256,
    size,
    sizeBytes: size,
    notes,
    releaseNotes: notes,
  };

  const latestWinPath = join(outDir, "latest-win.json");
  const latestPath = join(outDir, "latest.json");
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  writeFileSync(latestWinPath, manifestJson, "utf8");
  writeFileSync(latestPath, manifestJson, "utf8");

  console.log(`\n📦 [Release R2] ${info.appName} v${version}`);
  console.log(`   Setup File : ${primaryPath} (${(size / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`   SHA-256    : ${sha256}`);
  console.log(`   Target R2  : ${bucket}/${installerKey}`);

  let uploaded = false;
  if (options.uploadToR2 && !options.dryRun) {
    console.log(`\n☁️  Uploading setup & manifests to Cloudflare R2 (${bucket})...`);
    await upload(primaryPath, { key: installerKey, bucket, skipContractCheck: true });
    console.log(`   ✓ Uploaded setup binary: ${installerKey}`);

    await upload(checksumPath, { key: checksumKey, bucket, skipContractCheck: true });
    console.log(`   ✓ Uploaded checksum: ${checksumKey}`);

    await upload(latestWinPath, {
      key: latestWinKey,
      bucket,
      cacheControl: "no-cache, no-store, must-revalidate",
      skipContractCheck: true,
    });
    console.log(`   ✓ Uploaded manifest: ${latestWinKey}`);

    await upload(latestPath, {
      key: latestKey,
      bucket,
      cacheControl: "no-cache, no-store, must-revalidate",
      skipContractCheck: true,
    });
    console.log(`   ✓ Uploaded manifest: ${latestKey}`);
    uploaded = true;
  } else {
    console.log(`   ℹ️ Dry-run / local mode: R2 upload skipped (pass --upload to publish to R2).`);
  }

  return {
    appSlug,
    version,
    installerPath: primaryPath,
    installerName,
    sha256,
    size,
    installerUrl,
    manifestUrl,
    manifest,
    uploaded,
  };
}

export function parseReleaseArgs(argv: string[]): ReleaseR2Options {
  const opts: ReleaseR2Options = {
    bump: false,
    build: false,
    uploadToR2: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--bump") opts.bump = true;
    else if (a === "--build") opts.build = true;
    else if (a === "--upload" || a === "--r2") opts.uploadToR2 = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--installer" && argv[i + 1]) opts.installerPath = argv[++i];
    else if (a === "--prefix" && argv[i + 1]) opts.prefix = argv[++i];
    else if (a === "--version" && argv[i + 1]) opts.version = argv[++i];
    else if (a === "--notes" && argv[i + 1]) opts.notes = argv[++i];
  }
  if (!opts.bump && !opts.build && !opts.uploadToR2 && !opts.dryRun) {
    opts.dryRun = true;
  }
  return opts;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMain) {
  const opts = parseReleaseArgs(process.argv.slice(2));
  releaseToR2(opts)
    .then((res) => {
      console.log(`\n✅ Release R2 complete (v${res.version}, uploaded=${res.uploaded})`);
      console.log(`   Installer URL: ${res.installerUrl}`);
      console.log(`   Manifest URL : ${res.manifestUrl}`);
    })
    .catch((err) => {
      console.error(`\n❌ Release R2 failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
