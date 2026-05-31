#!/usr/bin/env node
/**
 * Localize docs batch.
 */
const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

function usage() {
  console.log(`Usage:
  node tools/localize-docs-batch.js [options]

Options:
  --source <dir>             Source docs directory. Default: docs
  --output-root <dir>        Output root directory. Default: docs-locate
  --page-dir <dir>           HTML output directory, relative to output root unless absolute. Default: page
  --assets-dir <dir>         Asset output directory, relative to output root unless absolute. Default: offline-assets
  --single-script <file>     Single-page localizer script. Default: tools/localize-html-assets.js
  --pattern <suffix>         Only process HTML files with this suffix. Default: .html
  --from <relative-file>     Start from this source-relative file path.
  --limit <n>                Process at most n files.
  --timeout <ms>             Forwarded to the single-page script. Default: 30000
  --asset-timeout <ms>       Alias for --timeout.
  --asset-concurrency <n>    Forwarded as --concurrency. Default: 6
  --retries <n>              Forwarded to the single-page script. Default: 2
  --proxy-server <url>       Forwarded to the single-page script, e.g. http://127.0.0.1:7890
  --no-system-proxy          Forwarded to the single-page script.
  --refresh                  Force re-download assets.
  --keep-resource-hints      Forwarded to the single-page script.
  --continue-on-error        Continue after a page fails.
  --dry-run                  Print planned page mappings without processing.
  --help                     Show this help.

Output layout:
  docs-locate/
    offline-assets/          Shared localized static resources.
    page/                    HTML files with the same relative structure as docs/.
`);
}

function parseArgs(argv) {
  const args = {
    source: "docs",
    outputRoot: "docs-locate",
    pageDir: "page",
    assetsDir: "offline-assets",
    singleScript: "tools/localize-html-assets.js",
    pattern: ".html",
    timeout: 30000,
    assetConcurrency: 6,
    retries: 2,
    refresh: false,
    keepResourceHints: false,
    noSystemProxy: false,
    continueOnError: false,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--refresh") {
      args.refresh = true;
    } else if (arg === "--keep-resource-hints") {
      args.keepResourceHints = true;
    } else if (arg === "--no-system-proxy") {
      args.noSystemProxy = true;
    } else if (arg === "--continue-on-error") {
      args.continueOnError = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
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

  if (args.assetTimeout) args.timeout = args.assetTimeout;
  args.timeout = Number(args.timeout);
  args.assetConcurrency = Number(args.assetConcurrency);
  args.retries = Number(args.retries);
  if (!Number.isInteger(args.timeout) || args.timeout < 1) {
    throw new Error("--timeout must be a positive integer");
  }
  if (!Number.isInteger(args.assetConcurrency) || args.assetConcurrency < 1) {
    throw new Error("--asset-concurrency must be a positive integer");
  }
  if (!Number.isInteger(args.retries) || args.retries < 0) {
    throw new Error("--retries must be a non-negative integer");
  }
  if (args.limit !== undefined) {
    args.limit = Number(args.limit);
    if (!Number.isInteger(args.limit) || args.limit < 1) {
      throw new Error("--limit must be a positive integer");
    }
  }

  return args;
}

function resolveInside(root, child) {
  return path.isAbsolute(child) ? child : path.join(root, child);
}

function toDisplayPath(filePath) {
  return filePath.split(path.sep).join("/");
}

async function findHtmlFiles(dir, suffix) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findHtmlFiles(fullPath, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(fullPath);
    }
  }

  return files;
}

function runNodeScript(scriptPath, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  const cwd = process.cwd();
  const sourceDir = path.resolve(cwd, args.source);
  const outputRoot = path.resolve(cwd, args.outputRoot);
  const pageDir = path.resolve(cwd, resolveInside(args.outputRoot, args.pageDir));
  const assetsDir = path.resolve(cwd, resolveInside(args.outputRoot, args.assetsDir));
  const singleScript = path.resolve(cwd, args.singleScript);

  await fs.access(singleScript);
  const htmlFiles = await findHtmlFiles(sourceDir, args.pattern);
  let jobs = htmlFiles.map((input) => {
    const relative = path.relative(sourceDir, input);
    return {
      input,
      output: path.join(pageDir, relative),
      relative,
    };
  });

  if (args.from) {
    const normalizedFrom = toDisplayPath(args.from);
    const startIndex = jobs.findIndex((job) => toDisplayPath(job.relative) === normalizedFrom);
    if (startIndex === -1) {
      throw new Error(`--from did not match any file under ${args.source}: ${args.from}`);
    }
    jobs = jobs.slice(startIndex);
  }
  if (args.limit !== undefined) {
    jobs = jobs.slice(0, args.limit);
  }

  console.log(`Source: ${sourceDir}`);
  console.log(`Output root: ${outputRoot}`);
  console.log(`HTML output: ${pageDir}`);
  console.log(`Assets: ${assetsDir}`);
  console.log(`Pages: ${jobs.length}`);

  if (args.dryRun) {
    for (const job of jobs) {
      console.log(`${toDisplayPath(job.relative)} -> ${toDisplayPath(path.relative(cwd, job.output))}`);
    }
    return;
  }

  await fs.mkdir(pageDir, { recursive: true });
  await fs.mkdir(assetsDir, { recursive: true });

  const failures = [];
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    console.log(`\n[${index + 1}/${jobs.length}] ${toDisplayPath(job.relative)}`);

    const forwarded = [
      "--input", job.input,
      "--output", job.output,
      "--assets-dir", assetsDir,
      "--concurrency", String(args.assetConcurrency),
      "--timeout", String(args.timeout),
      "--retries", String(args.retries),
    ];
    if (args.refresh) forwarded.push("--refresh");
    if (args.keepResourceHints) forwarded.push("--keep-resource-hints");
    if (args.noSystemProxy) forwarded.push("--no-system-proxy");
    if (args.proxyServer) forwarded.push("--proxy-server", args.proxyServer);

    const result = await runNodeScript(singleScript, forwarded, cwd);
    if (result.code !== 0) {
      failures.push({ relative: job.relative, code: result.code, signal: result.signal });
      console.error(`Failed: ${toDisplayPath(job.relative)} (${result.signal || `exit ${result.code}`})`);
      if (!args.continueOnError) break;
    }
  }

  if (failures.length) {
    console.error(`\nCompleted with ${failures.length} failed page(s):`);
    for (const failure of failures) {
      console.error(`- ${toDisplayPath(failure.relative)} (${failure.signal || `exit ${failure.code}`})`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nAll pages localized successfully.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
