// upload-r2.ts — push a file to a Cloudflare R2 bucket and return its URL.
//
// Cloudflare R2 is S3-API-compatible, so we drive it with the AWS SDK v3 S3 client
// pointed at the R2 endpoint (https://<account_id>.r2.cloudflarestorage.com).
//
// Required env (loaded from process.env or .env.r2 / .env):
//   R2_ACCESS_KEY_ID      R2 S3 access key
//   R2_SECRET_ACCESS_KEY  R2 S3 secret key
//   R2_BUCKET             target bucket (default: edulinker-download)
//   R2_REGION             region        (default: auto)
//   R2_ENDPOINT           S3 endpoint   (default: https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com)

import { basename, extname, resolve } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { log } from "./telemetry.ts";
import { checkStoragePath } from "./data-contract.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".dmg": "application/x-apple-diskimage",
  ".zip": "application/zip",
  ".msi": "application/x-msi",
  ".sha256": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] || "application/octet-stream";
}

export function loadR2EnvIfNeeded(): void {
  const home = homedir();
  const candidates = [
    resolve(process.cwd(), ".env.r2"),
    resolve(process.cwd(), ".env"),
    resolve(home, "works/edulinker_v2/.env.r2"),
    resolve(home, "works/edulinker_v2/.env"),
    resolve(home, "works/i-bank/.env.r2"),
    resolve(home, "works/i-bank/.env"),
    "D:/works/edulinker_v2/.env.r2",
    "D:/works/edulinker_v2/.env",
    "D:/works/i-bank/.env.r2",
    "D:/works/i-bank/.env",
    "D:/works/self-check/.env.r2",
    "D:/works/self-check/.env",
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, "utf-8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch {
      // ignore unreadable candidate
    }
  }
}

export function requireR2Env() {
  loadR2EnvIfNeeded();
  const accountId =
    process.env.R2_ACCOUNT_ID ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    "9d5d05a9b5b1b7fde0163c4d83849cab";
  const region = process.env.R2_REGION || "auto";
  const endpoint =
    process.env.R2_ENDPOINT?.startsWith("http")
      ? process.env.R2_ENDPOINT
      : `https://${accountId}.r2.cloudflarestorage.com`;
  const accessKeyId =
    process.env.R2_ACCESS_KEY_ID ||
    process.env.R2_ACCESS_KEY ||
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY ||
    process.env.R2_SECRET_KEY ||
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY;
  const bucket =
    process.env.R2_BUCKET ||
    process.env.R2_UPDATE_BUCKET ||
    process.env.CLOUDFLARE_R2_BUCKET ||
    "edulinker-download";

  const cfg = {
    accessKeyId,
    secretAccessKey,
    bucket,
    region,
    endpoint,
  };
  const missing: string[] = [];
  if (!cfg.accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!cfg.secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!cfg.bucket) missing.push("R2_BUCKET");
  if (missing.length) {
    console.error(`missing required R2 env: ${missing.join(", ")}`);
    throw new Error(`missing required R2 env: ${missing.join(", ")}`);
  }
  return cfg;
}

/**
 * Zero-dependency AWS SigV4 PUT upload to Cloudflare R2 using built-in Node crypto + fetch.
 */
export async function putObjectSigV4(params: {
  endpoint: string;
  region: string;
  bucket: string;
  key: string;
  body: Buffer;
  accessKeyId: string;
  secretAccessKey: string;
  contentType: string;
  cacheControl?: string;
}): Promise<void> {
  const host = new URL(params.endpoint).hostname;
  const cleanKey = params.key.replace(/^\/+/, "");
  const pathname = `/${params.bucket}/${cleanKey}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(params.body).digest("hex");

  let canonicalHeaders =
    `content-length:${params.body.length}\n` +
    `content-type:${params.contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  let signedHeaders = "content-length;content-type;host;x-amz-content-sha256;x-amz-date";

  if (params.cacheControl) {
    canonicalHeaders = `cache-control:${params.cacheControl}\n` + canonicalHeaders;
    signedHeaders = `cache-control;${signedHeaders}`;
  }

  const canonicalRequest = ["PUT", pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const algorithm = "AWS4-HMAC-SHA256";
  const signRegion = params.region || "auto";
  const credentialScope = `${dateStamp}/${signRegion}/s3/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const hmac = (k: Buffer | string, str: string) => createHmac("sha256", k).update(str).digest();
  const kDate = hmac("AWS4" + params.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, signRegion);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const authHeader = `${algorithm} Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const targetUrl = `https://${host}${pathname}`;

  const headers: Record<string, string> = {
    Host: host,
    "Content-Length": String(params.body.length),
    "Content-Type": params.contentType,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: authHeader,
  };
  if (params.cacheControl) {
    headers["Cache-Control"] = params.cacheControl;
  }

  const resp = await fetch(targetUrl, {
    method: "PUT",
    headers,
    body: new Uint8Array(params.body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`R2 upload failed for ${cleanKey}: HTTP ${resp.status} ${resp.statusText}\n${errText}`);
  }
}

/**
 * Upload a local file to Cloudflare R2 and return its object URL.
 */
export async function upload(
  localPath: string,
  {
    key,
    bucket,
    cacheControl,
    skipContractCheck = false,
  }: { key?: string; bucket?: string; cacheControl?: string; skipContractCheck?: boolean } = {},
): Promise<string> {
  if (!localPath) {
    console.error("usage: upload(localPath, { key, bucket })");
    throw new Error("localPath is required");
  }
  const cfg = requireR2Env();
  const targetBucket = bucket || cfg.bucket;
  const objectKey = (key || `screenshots/prod-preview/${basename(localPath)}`).replace(/^\/+/, "");
  if (!skipContractCheck) {
    const contract = await checkStoragePath(objectKey);
    if (!contract.ok) throw new Error(`storage path violates data contract: ${contract.violations.join("; ")}`);
  }

  const body = readFileSync(localPath);
  const contentType = contentTypeFor(localPath);

  let s3sdk: any = null;
  try {
    const pkgName = "@aws-sdk/client-s3";
    s3sdk = await import(pkgName);
  } catch {
    s3sdk = null;
  }

  if (s3sdk) {
    const { S3Client, PutObjectCommand } = s3sdk;
    const client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId!, secretAccessKey: cfg.secretAccessKey! },
    });

    await client.send(
      new PutObjectCommand({
        Bucket: targetBucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
        ...(cacheControl ? { CacheControl: cacheControl } : {}),
      }),
    );
  } else {
    await putObjectSigV4({
      endpoint: cfg.endpoint,
      region: cfg.region,
      bucket: targetBucket,
      key: objectKey,
      body,
      accessKeyId: cfg.accessKeyId!,
      secretAccessKey: cfg.secretAccessKey!,
      contentType,
      cacheControl,
    });
  }

  const publicCdn = process.env.R2_PUBLIC_CDN_URL?.replace(/\/+$/, "");
  const url = publicCdn
    ? `${publicCdn}/${objectKey}`
    : `${cfg.endpoint}/${targetBucket}/${objectKey}`;

  try {
    await log("iterate", { actor: "r2", detail: { key: objectKey, url } });
  } catch {
    /* telemetry must never break the upload */
  }

  return url;
}

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

