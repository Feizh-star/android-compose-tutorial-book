#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { execFile } = require("child_process");
const { chromium, request } = require("playwright");

const STATIC_ATTRS = new Set([
  "href",
  "src",
  "srcset",
  "poster",
  "data-src",
  "data-srcset",
  "imagesrcset",
]);

const STATIC_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".mp4",
  ".png",
  ".svg",
  ".webm",
  ".webmanifest",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
]);

const SKIP_PROTOCOLS = new Set(["data:", "blob:", "mailto:", "tel:", "javascript:"]);

function usage() {
  console.log(`Usage:
  node tools/localize-html-assets.js --input <file.html> [options]

Options:
  --output <file.html>       Write localized HTML to this path.
  --in-place                 Rewrite the input file.
  --assets-dir <dir>         Asset output root. Default: <html-dir>/.offline-assets
  --base-url <url>           Base URL for root-relative assets. Default: inferred from canonical/og:url.
  --concurrency <n>          Concurrent downloads. Default: 6
  --retries <n>              Retries per asset download. Default: 2
  --timeout <ms>             Navigation/download timeout. Default: 30000
  --refresh                  Download again even when a local asset file already exists.
  --keep-resource-hints      Keep preconnect/dns-prefetch hints. Default: remove them.
  --dry-run                  Discover assets without writing files.
  --help                     Show this help.

Examples:
  node tools/localize-html-assets.js --input "test/01.准备工作.source.html" --output "test/01.准备工作.offline.html"
  node tools/localize-html-assets.js --input "docs/a.source.html" --in-place --assets-dir "docs/.offline-assets"
`);
}

function parseArgs(argv) {
  const args = {
    concurrency: 6,
    retries: 2,
    timeout: 30000,
    dryRun: false,
    inPlace: false,
    refresh: false,
    keepResourceHints: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--in-place") {
      args.inPlace = true;
    } else if (arg === "--refresh") {
      args.refresh = true;
    } else if (arg === "--keep-resource-hints") {
      args.keepResourceHints = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      args[key] = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.help) return args;
  if (!args.input) throw new Error("--input is required");
  if (args.inPlace && args.output) throw new Error("Use either --in-place or --output, not both");
  if (!args.inPlace && !args.output) {
    const parsed = path.parse(args.input);
    args.output = path.join(parsed.dir, `${parsed.name}.offline${parsed.ext}`);
  }
  args.concurrency = Number(args.concurrency);
  args.retries = Number(args.retries);
  args.timeout = Number(args.timeout);
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (!Number.isInteger(args.retries) || args.retries < 0) {
    throw new Error("--retries must be a non-negative integer");
  }
  return args;
}

function inferBaseUrl(html) {
  const patterns = [
    /<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["']/i,
    /<meta\b[^>]*\bproperty=["']og:url["'][^>]*\bcontent=["']([^"']+)["']/i,
    /<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bproperty=["']og:url["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtml(match[1]);
  }
  return "https://developer.android.com/";
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function normalizeUrl(raw, baseUrl) {
  if (!raw) return null;
  let value = decodeHtml(String(raw).trim());
  if (!value || value.startsWith("#")) return null;
  if (value.startsWith("//")) value = `https:${value}`;

  try {
    const url = new URL(value, baseUrl);
    if (SKIP_PROTOCOLS.has(url.protocol)) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function parseSrcset(value, baseUrl) {
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .map((candidate) => normalizeUrl(candidate, baseUrl))
    .filter(Boolean);
}

function looksLikeStatic(urlString) {
  const url = new URL(urlString);
  const ext = path.extname(url.pathname).toLowerCase();
  if (STATIC_EXTENSIONS.has(ext)) return true;
  if (/fonts\.googleapis\.com$/i.test(url.hostname)) return true;
  if (/fonts\.gstatic\.com$/i.test(url.hostname)) return true;
  if (/\/manifest\.json$/i.test(url.pathname)) return true;
  return false;
}

function discoverUrls(text, baseUrl, options = {}) {
  const urls = new Set();
  const isCss = options.kind === "css";

  if (!isCss) {
    const attrPattern = /\b([a-zA-Z][\w:-]*)\s*=\s*(["'])([\s\S]*?)\2/g;
    for (const match of text.matchAll(attrPattern)) {
      const attr = match[1].toLowerCase();
      const value = match[3];
      if (!STATIC_ATTRS.has(attr)) continue;
      if (attr.includes("srcset")) {
        for (const url of parseSrcset(value, baseUrl)) urls.add(url);
      } else {
        const url = normalizeUrl(value, baseUrl);
        if (url) urls.add(url);
      }
    }
  }

  const cssUrlPattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^'")]+))\s*\)/g;
  for (const match of text.matchAll(cssUrlPattern)) {
    const url = normalizeUrl(match[1] || match[2] || match[3], baseUrl);
    if (url) urls.add(url);
  }

  const importPattern = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^'");\s]+))/g;
  for (const match of text.matchAll(importPattern)) {
    const url = normalizeUrl(match[1] || match[2] || match[3], baseUrl);
    if (url) urls.add(url);
  }

  const absolutePattern = /(?:https?:)?\/\/[^\s"'<>\\)]+/g;
  for (const match of text.matchAll(absolutePattern)) {
    const url = normalizeUrl(match[0], baseUrl);
    if (url && looksLikeStatic(url)) urls.add(url);
  }

  return [...urls].filter(looksLikeStatic);
}

function safeSegment(segment) {
  const decoded = decodeURIComponentSafe(segment);
  return decoded
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+$/g, "_")
    .slice(0, 150) || "_";
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function filePathForUrl(urlString, assetsDir) {
  const url = new URL(urlString);
  const segments = url.pathname.split("/").filter(Boolean).map(safeSegment);
  if (segments.length === 0) segments.push("index");

  let fileName = segments.pop();
  if (fileName.endsWith("/")) fileName += "index";
  if (!path.extname(fileName)) {
    const guessed = extensionFromUrl(urlString);
    fileName += guessed || ".asset";
  }
  if (url.search) {
    const ext = path.extname(fileName);
    const base = fileName.slice(0, fileName.length - ext.length);
    fileName = `${base}.${hash(url.search)}${ext}`;
  }

  return path.join(assetsDir, safeSegment(url.hostname), ...segments, fileName);
}

function extensionFromUrl(urlString) {
  if (/fonts\.googleapis\.com/i.test(urlString)) return ".css";
  return "";
}

function contentKind(urlString, contentType = "") {
  const ext = path.extname(new URL(urlString).pathname).toLowerCase();
  if (contentType.includes("text/css") || ext === ".css" || /fonts\.googleapis\.com/i.test(urlString)) {
    return "css";
  }
  if (contentType.includes("javascript") || [".js", ".mjs"].includes(ext)) return "js";
  return "asset";
}

async function discoverWithBrowser(html, baseUrl, timeout) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } });
  page.setDefaultTimeout(timeout);

  const seen = new Set();
  const assets = new Map();
  const responsePromises = [];
  page.on("response", (response) => {
    const url = normalizeUrl(response.url(), baseUrl);
    if (!url || !looksLikeStatic(url)) return;
    seen.add(url);
    responsePromises.push((async () => {
      try {
        await response.finished();
        const body = await response.body();
        assets.set(url, {
          body,
          contentType: response.headers()["content-type"] || "",
        });
      } catch {
        // Some cross-origin or failed responses cannot expose a body; the downloader will retry them.
      }
    })());
  });

  const htmlWithBase = html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}<base href="${baseUrl}">`);

  try {
    await page.setContent(htmlWithBase, { waitUntil: "networkidle", timeout });
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let y = 0;
        const step = Math.max(window.innerHeight - 100, 400);
        const timer = setInterval(() => {
          window.scrollTo(0, y);
          y += step;
          if (y > document.documentElement.scrollHeight + step) {
            clearInterval(timer);
            resolve();
          }
        }, 80);
      });
    });
    await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
  } finally {
    await Promise.allSettled(responsePromises);
    await browser.close();
  }

  return { urls: [...seen], assets };
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

async function downloadWithRetry(context, urlString, baseUrl, timeout, retries) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await context.get(urlString, {
        headers: { Referer: baseUrl },
        timeout,
      });
      if (response.ok()) return response;
      lastError = new Error(`HTTP ${response.status()}`);
      if (response.status() === 404) return response;
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

function execFilePromise(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function downloadWithPowerShell(urlString, timeout) {
  if (process.platform !== "win32") return null;

  const tempFile = path.join(os.tmpdir(), `codex-html-asset-${hash(urlString)}.download`);
  const timeoutSec = Math.max(1, Math.ceil(timeout / 1000));
  const command = [
    "$ProgressPreference = 'SilentlyContinue'",
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
    `$response = Invoke-WebRequest -Uri ${JSON.stringify(urlString)} -OutFile ${JSON.stringify(tempFile)} -UseBasicParsing -TimeoutSec ${timeoutSec} -PassThru`,
    `Write-Output $response.StatusCode`,
  ].join("; ");
  const encoded = Buffer.from(command, "utf16le").toString("base64");

  await execFilePromise("powershell.exe", ["-NoProfile", "-EncodedCommand", encoded], {
    timeout: timeout + 5000,
    windowsHide: true,
  });
  const body = await fs.readFile(tempFile);
  await fs.rm(tempFile, { force: true }).catch(() => {});
  return { body, contentType: "" };
}

async function writeAssetBody(record, body, contentType, queue, records) {
  record.contentType = contentType;
  record.kind = contentKind(record.url, contentType);

  await fs.mkdir(path.dirname(record.localPath), { recursive: true });
  await fs.writeFile(record.localPath, body);
  record.ok = true;

  if (record.kind === "css") {
    const text = body.toString("utf8");
    const nested = discoverUrls(text, record.url, { kind: "css" });
    for (const nestedUrl of nested) {
      if (!records.has(nestedUrl) && !queue.includes(nestedUrl)) queue.push(nestedUrl);
    }
  }
}

async function downloadAll(initialUrls, baseUrl, assetsDir, concurrency, timeout, retries, dryRun, refresh, preloadedAssets) {
  const context = await request.newContext({
    extraHTTPHeaders: {
      "User-Agent": "Mozilla/5.0 Playwright offline asset localizer",
    },
    timeout,
  });

  const queue = [...new Set(initialUrls)];
  const records = new Map();
  const failures = [];

  for (let cursor = 0; cursor < queue.length; ) {
    const batch = queue.slice(cursor, cursor + concurrency);
    cursor += batch.length;

    await mapLimit(batch, concurrency, async (urlString) => {
      if (records.has(urlString)) return;
      const localPath = filePathForUrl(urlString, assetsDir);
      const record = { url: urlString, localPath, kind: "asset", contentType: "", ok: false };
      records.set(urlString, record);

      if (dryRun) {
        record.ok = true;
        return;
      }

      try {
        const preloaded = preloadedAssets.get(urlString);
        if (!refresh && preloaded) {
          await writeAssetBody(record, preloaded.body, preloaded.contentType, queue, records);
          return;
        }

        if (!refresh) {
          try {
            await fs.access(localPath);
            record.ok = true;
            const text = path.extname(localPath).toLowerCase() === ".css"
              ? await fs.readFile(localPath, "utf8").catch(() => null)
              : null;
            if (text !== null) {
              record.kind = "css";
              const nested = discoverUrls(text, urlString, { kind: "css" });
              for (const nestedUrl of nested) {
                if (!records.has(nestedUrl) && !queue.includes(nestedUrl)) queue.push(nestedUrl);
              }
            }
            return;
          } catch {
            // File is not present yet; download below.
          }
        }

        const response = await downloadWithRetry(context, urlString, baseUrl, timeout, retries);
        if (!response.ok()) {
          failures.push({ url: urlString, status: response.status() });
          return;
        }

        const contentType = response.headers()["content-type"] || "";
        const body = await response.body();
        await writeAssetBody(record, body, contentType, queue, records);
      } catch (error) {
        try {
          const fallback = await downloadWithPowerShell(urlString, timeout);
          if (fallback) {
            await writeAssetBody(record, fallback.body, fallback.contentType, queue, records);
            return;
          }
        } catch (fallbackError) {
          failures.push({ url: urlString, error: `${error.message}; PowerShell fallback: ${fallbackError.message}` });
          return;
        }
        failures.push({ url: urlString, error: error.message });
      }
    });
  }

  await context.dispose();
  return { records, failures };
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function relativeRef(fromFile, toFile) {
  let rel = toPosixPath(path.relative(path.dirname(fromFile), toFile));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function variantsForUrl(urlString, baseUrl, includeRootRelative = true) {
  const url = new URL(urlString);
  const variants = new Set([url.href, url.href.replace(/&/g, "&amp;")]);
  variants.add(`//${url.host}${url.pathname}${url.search}`);
  variants.add(`//${url.host}${url.pathname}${url.search}`.replace(/&/g, "&amp;"));

  const base = new URL(baseUrl);
  if (includeRootRelative && url.origin === base.origin) {
    variants.add(`${url.pathname}${url.search}`);
    variants.add(`${url.pathname}${url.search}`.replace(/&/g, "&amp;"));
  }
  return [...variants].sort((a, b) => b.length - a.length);
}

function replaceAllLiteral(text, search, replacement) {
  return text.split(search).join(replacement);
}

function rewriteDirectoryPrefixes(text, records, targetFile) {
  let output = text;
  const prefixes = new Map();

  for (const record of records.values()) {
    if (!record.ok) continue;
    const url = new URL(record.url);
    let remotePath = url.pathname.slice(0, url.pathname.lastIndexOf("/"));
    let localDir = path.dirname(record.localPath);

    while (remotePath && remotePath !== "/") {
      const depth = remotePath.split("/").filter(Boolean).length;
      if (depth >= 2) {
        const remoteDir = `${url.origin}${remotePath}`;
        const existing = prefixes.get(remoteDir);
        if (!existing || localDir.length > existing.length) {
          prefixes.set(remoteDir, localDir);
        }
      }

      const nextRemote = remotePath.slice(0, remotePath.lastIndexOf("/"));
      if (nextRemote === remotePath) break;
      remotePath = nextRemote;
      localDir = path.dirname(localDir);
    }

    if (url.hostname === "www.gstatic.com") {
      const hostDir = record.localPath.split(`${path.sep}${safeSegment(url.hostname)}${path.sep}`)[0]
        + `${path.sep}${safeSegment(url.hostname)}`;
      if (!prefixes.has(url.origin)) {
        prefixes.set(url.origin, hostDir);
      }
    }
  }

  const sorted = [...prefixes.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [remoteDir, localDir] of sorted) {
    const replacement = relativeRef(targetFile, localDir);
    output = replaceAllLiteral(output, remoteDir, replacement);
    output = replaceAllLiteral(output, remoteDir.replace(/^https?:/, ""), replacement);
  }
  return output;
}

function rewriteText(text, records, targetFile, baseUrl, options = {}) {
  let output = text;
  const includeRootRelative = options.includeRootRelative !== false;
  const sorted = [...records.values()].filter((record) => record.ok).sort((a, b) => b.url.length - a.url.length);
  for (const record of sorted) {
    const replacement = relativeRef(targetFile, record.localPath);
    for (const variant of variantsForUrl(record.url, baseUrl, includeRootRelative)) {
      output = replaceAllLiteral(output, variant, replacement);
    }
  }
  return rewriteDirectoryPrefixes(output, records, targetFile);
}

function removeResourceHints(html) {
  return html.replace(
    /<link\b(?=[^>]*\brel=["'](?:preconnect|dns-prefetch|preload|modulepreload)["'])[^>]*>/gi,
    "",
  );
}

async function rewriteAssetTextFiles(records, baseUrl) {
  for (const record of records.values()) {
    const ext = path.extname(record.localPath).toLowerCase();
    if (record.kind !== "css" && record.kind !== "js" && ext !== ".css" && ext !== ".js" && ext !== ".mjs") continue;
    let text;
    try {
      text = await fs.readFile(record.localPath, "utf8");
    } catch {
      continue;
    }
    const rewritten = rewriteText(text, records, record.localPath, record.url || baseUrl, {
      includeRootRelative: ext !== ".js" && ext !== ".mjs",
    });
    if (rewritten !== text) {
      await fs.writeFile(record.localPath, rewritten, "utf8");
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  const inputPath = path.resolve(args.input);
  const html = await fs.readFile(inputPath, "utf8");
  const baseUrl = args.baseUrl || inferBaseUrl(html);
  const outputPath = path.resolve(args.inPlace ? inputPath : args.output);
  const assetsDir = path.resolve(args.assetsDir || path.join(path.dirname(outputPath), ".offline-assets"));

  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Assets: ${assetsDir}`);
  console.log(`Base URL: ${baseUrl}`);

  const htmlUrls = discoverUrls(html, baseUrl, { kind: "html" });
  const browserDiscovery = await discoverWithBrowser(html, baseUrl, args.timeout).catch((error) => {
    console.warn(`Browser discovery failed, continuing with parsed URLs: ${error.message}`);
    return { urls: [], assets: new Map() };
  });
  const initialUrls = [...new Set([...htmlUrls, ...browserDiscovery.urls])].filter(looksLikeStatic);
  console.log(`Discovered ${initialUrls.length} initial asset URLs.`);

  const { records, failures } = await downloadAll(
    initialUrls,
    baseUrl,
    assetsDir,
    args.concurrency,
    args.timeout,
    args.retries,
    args.dryRun,
    args.refresh,
    browserDiscovery.assets,
  );

  if (!args.dryRun) {
    await rewriteAssetTextFiles(records, baseUrl);
    const normalizedHtml = args.keepResourceHints ? html : removeResourceHints(html);
    const rewrittenHtml = rewriteText(normalizedHtml, records, outputPath, baseUrl);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, rewrittenHtml, "utf8");
  }

  const savedCount = [...records.values()].filter((record) => record.ok).length;
  console.log(`Saved/reused ${savedCount} assets.`);
  if (failures.length) {
    console.warn(`Failed ${failures.length} assets:`);
    for (const failure of failures.slice(0, 20)) {
      console.warn(`- ${failure.status || failure.error}: ${failure.url}`);
    }
    if (failures.length > 20) console.warn(`...and ${failures.length - 20} more`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
