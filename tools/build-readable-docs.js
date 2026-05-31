#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { pathToFileURL, fileURLToPath } = require("url");
const { chromium } = require("playwright");

// node tools/build-readable-docs.js --limit 10 --output docs-locate\readable-test
function usage() {
  console.log(`Usage:
  node tools/build-readable-docs.js [options]

Options:
  --source <dir>       Source localized HTML directory. Default: docs-locate/page
  --output <dir>       Output readable site directory. Default: docs-locate/readable
  --assets <dir>       Existing offline assets directory. Default: docs-locate/offline-assets
  --limit <n>          Process at most n pages.
  --help               Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    source: "docs-locate/page",
    output: "docs-locate/readable",
    assets: "docs-locate/offline-assets",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      args[key] = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.limit !== undefined) {
    args.limit = Number(args.limit);
    if (!Number.isInteger(args.limit) || args.limit < 1) {
      throw new Error("--limit must be a positive integer");
    }
  }
  return args;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function relativeUrl(fromFile, toPath) {
  let rel = toPosix(path.relative(path.dirname(fromFile), toPath));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return encodeURI(rel).replace(/#/g, "%23");
}

async function findHtmlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findHtmlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }
  return files;
}

function pageTitleFromRelative(relative) {
  return path.basename(relative, path.extname(relative)).replace(/\.source$/, "");
}

function sectionTitleFromRelative(relative, depth) {
  const parts = relative.split(path.sep);
  return parts[depth] || "";
}

function buildTree(pages) {
  const root = [];
  const maps = [new Map(), new Map()];

  for (const page of pages) {
    const parts = page.relative.split(path.sep);
    const unitName = parts[0] || "未分组";
    const chapterName = parts[1] || "未分组";

    let unit = maps[0].get(unitName);
    if (!unit) {
      unit = { title: unitName, children: [], pages: [] };
      maps[0].set(unitName, unit);
      root.push(unit);
    }

    const chapterKey = `${unitName}/${chapterName}`;
    let chapter = maps[1].get(chapterKey);
    if (!chapter) {
      chapter = { title: chapterName, children: [], pages: [] };
      maps[1].set(chapterKey, chapter);
      unit.children.push(chapter);
    }
    chapter.pages.push(page);
  }

  return root;
}

function renderNavTree(tree, currentOutputRelative = "") {
  const indent = 16
  return tree.map((unit) => `
    <section class="nav-unit">
      <h2>${escapeHtml(String(unit.title).replace(/^\d{1,2}\./, ''))}</h2>
      ${unit.children.map((chapter) => `
        <div class="nav-chapter">
          <h3 style="padding-left: ${indent * 1}px;">${escapeHtml(String(chapter.title).replace(/^\d{1,2}\./, ''))}</h3>
          <ol style="padding-left: ${indent * 2 + 20}px;">
            ${chapter.pages.map((page) => {
              const href = currentOutputRelative
                ? relativeUrl(path.join("x", currentOutputRelative), path.join("x", page.outputRelative))
                : page.outputRelative;
              const active = currentOutputRelative === page.outputRelative ? " class=\"active\"" : "";
              return `<li><a${active} href="${escapeHtml(href)}">${escapeHtml(String(page.title).replace(/^\d{1,2}\./, ''))}</a></li>`;
            }).join("\n")}
          </ol>
        </div>
      `).join("\n")}
    </section>
  `).join("\n");
}

function readableCss() {
  return `
:root {
  color-scheme: light;
  --bg: #f7f9fc;
  --paper: #fff;
  --text: #202124;
  --muted: #5f6368;
  --border: #dadce0;
  --link: #0b57d0;
  --code-bg: #f1f3f4;
  --note-bg: #eef4ff;
  --warn-bg: #fff7e6;
  --special-bg: #eef7ee;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.72 "Google Sans Text", "Google Sans", Arial, sans-serif;
}
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
.layout { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); min-height: 100vh; }
.sidebar {
  background: #fff;
  border-right: 1px solid var(--border);
  height: 100vh;
  overflow: auto;
  padding: 18px 18px 28px;
  position: sticky;
  top: 0;
}
.sidebar-title { font-size: 18px; margin: 0 0 16px; }
.nav-unit h2 { font-size: 15px; margin: 20px 0 8px; }
.nav-chapter h3 { color: var(--muted); font-size: 13px; font-weight: 500; margin: 12px 0 4px; }
.nav-chapter ol { margin: 0; padding-left: 22px; }
.nav-chapter li { margin: 4px 0; }
.nav-chapter a { color: #3c4043; font-size: 13px; }
.nav-chapter a.active { color: var(--link); font-weight: 600; }
.reader-shell { padding: 40px min(6vw, 72px); }
.article {
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin: 0 auto;
  max-width: 980px;
  padding: 42px min(6vw, 72px);
}
.article-title { font-size: 34px; line-height: 1.2; margin: 0 0 28px; }
.back-link { display: inline-block; font-size: 14px; margin-bottom: 20px; }
h2, h3, h4 { line-height: 1.35; scroll-margin-top: 24px; }
h2 { border-top: 1px solid var(--border); font-size: 26px; margin: 42px 0 14px; padding-top: 28px; }
h2:first-child { border-top: 0; margin-top: 0; padding-top: 0; }
h3 { font-size: 20px; margin: 28px 0 12px; }
p, ul, ol, pre, aside { margin: 14px 0; }
li { margin: 6px 0; }
img { height: auto; max-width: 100%; }
.image-container { text-align: center; }
code {
  background: var(--code-bg);
  border-radius: 4px;
  font-family: "Roboto Mono", Consolas, monospace;
  font-size: .92em;
  padding: 1px 4px;
}
devsite-code { display: block; }
pre {
  background: #202124;
  border-radius: 6px;
  color: #e8eaed;
  font-family: "Roboto Mono", Consolas, monospace;
  font-size: 14px;
  line-height: 1.55;
  overflow: auto;
  padding: 16px;
}
pre code { background: transparent; color: inherit; padding: 0; }
aside {
  border-left: 4px solid #1a73e8;
  border-radius: 4px;
  padding: 12px 16px;
}
aside.special { background: var(--special-bg); border-left-color: #188038; }
aside.warning { background: var(--warn-bg); border-left-color: #f9ab00; }
aside:not(.special):not(.warning) { background: var(--note-bg); }
.checklist { list-style: none; padding-left: 0; }
ul.checklist li::before { color: #188038; content: "✓"; font-weight: 700; margin-right: 8px; }
.pager { border-top: 1px solid var(--border); display: flex; gap: 16px; justify-content: space-between; margin-top: 42px; padding-top: 22px; }
.home {
  max-width: 1180px;
  margin: 0 auto;
  padding: 36px;
}
.home h1 { margin: 0 0 8px; }
.home .nav-unit { background: #fff; border: 1px solid var(--border); border-radius: 8px; margin: 18px 0; padding: 18px 22px; }
.devsite-syntax-k, .devsite-syntax-kd { color: #c792ea; }
.devsite-syntax-nf, .devsite-syntax-na { color: #82aaff; }
.devsite-syntax-s, .devsite-syntax-s2 { color: #c3e88d; }
.devsite-syntax-c, .devsite-syntax-c1 { color: #9aa0a6; }
.devsite-syntax-mi, .devsite-syntax-m { color: #f78c6c; }
@media (max-width: 900px) {
  .layout { display: block; }
  .sidebar { height: auto; max-height: 45vh; position: static; }
  .reader-shell { padding: 18px; }
  .article { padding: 28px 20px; }
}
`;
}

async function extractPage(page, inputPath, outputPath, assetsDir) {
  const html = await fs.readFile(inputPath, "utf8");
  const inputUrl = pathToFileURL(inputPath).href;
  const outputFileForRel = outputPath;
  const assetsRoot = path.resolve(assetsDir);

  await page.setContent(`<base href="${inputUrl}">${html}`, { waitUntil: "domcontentloaded" });

  return await page.evaluate(({ outputFileForRel, assetsRoot }) => {
    const escapeHtml = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const toPath = (url) => {
      if (!url.startsWith("file:///")) return "";
      return decodeURIComponent(url.replace(/^file:\/\/\//, "").replace(/\//g, "\\"));
    };

    const toPosix = (value) => value.replaceAll("\\", "/");
    const dirname = (value) => value.replace(/[\\/][^\\/]*$/, "");
    const relativePath = (fromDir, toFile) => {
      const from = toPosix(fromDir).split("/").filter(Boolean);
      const to = toPosix(toFile).split("/").filter(Boolean);
      while (from.length && to.length && from[0].toLowerCase() === to[0].toLowerCase()) {
        from.shift();
        to.shift();
      }
      return "../".repeat(from.length) + to.join("/");
    };

    const outputDir = dirname(outputFileForRel);
    const rewriteOne = (raw) => {
      if (!raw || raw.startsWith("data:") || raw.startsWith("#") || /^(https?:|mailto:|tel:)/i.test(raw)) return raw;
      const absolute = new URL(raw, document.baseURI).href;
      const filePath = toPath(absolute);
      if (!filePath || !filePath.toLowerCase().startsWith(assetsRoot.toLowerCase())) return raw;
      const rel = relativePath(outputDir, filePath);
      return encodeURI(rel).replaceAll("#", "%23");
    };

    const rewriteSrcset = (value) => value.split(",").map((part) => {
      const pieces = part.trim().split(/\s+/);
      if (!pieces[0]) return "";
      pieces[0] = rewriteOne(pieces[0]);
      return pieces.join(" ");
    }).filter(Boolean).join(", ");

    const codelab = document.querySelector("google-codelab");
    if (!codelab) throw new Error("Missing google-codelab");

    const title = codelab.getAttribute("title")
      || document.querySelector("h1.devsite-page-title")?.textContent.trim()
      || document.title
      || "Untitled";

    const steps = Array.from(codelab.querySelectorAll("google-codelab-step"));
    const article = document.createElement("article");
    for (const step of steps) {
      const section = document.createElement("section");
      section.className = "doc-step";
      section.setAttribute("data-step", step.getAttribute("step") || "");
      section.innerHTML = step.innerHTML;
      section.querySelectorAll("google-codelab-about, google-codelab-survey, google-codelab-feedback").forEach((el) => el.remove());
      article.append(...Array.from(section.childNodes));
    }

    article.querySelectorAll("img").forEach((img) => {
      if (img.hasAttribute("src")) img.setAttribute("src", rewriteOne(img.getAttribute("src")));
      if (img.hasAttribute("srcset")) img.setAttribute("srcset", rewriteSrcset(img.getAttribute("srcset")));
      img.removeAttribute("sizes");
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
    });
    article.querySelectorAll("[href]").forEach((el) => {
      const raw = el.getAttribute("href");
      if (raw && !/^(https?:|mailto:|tel:|#)/i.test(raw)) el.setAttribute("href", rewriteOne(raw));
    });
    article.querySelectorAll("devsite-code").forEach((el) => {
      const pre = el.querySelector("pre");
      if (pre) el.replaceWith(pre);
    });
    article.querySelectorAll("[is-upgraded], [tabindex], [data-text]").forEach((el) => {
      el.removeAttribute("is-upgraded");
      el.removeAttribute("data-text");
      if (el.getAttribute("tabindex") === "-1") el.removeAttribute("tabindex");
    });
    article.querySelectorAll("h2.step-title").forEach((h2) => h2.classList.remove("step-title"));

    const headings = Array.from(article.querySelectorAll("h2, h3")).map((heading, index) => {
      if (!heading.id) heading.id = `heading-${index + 1}`;
      return { id: heading.id, text: heading.textContent.trim(), level: heading.tagName.toLowerCase() };
    });

    return {
      title,
      body: article.innerHTML,
      headings,
      fontLinks: Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map((link) => link.getAttribute("href"))
        .filter((href) => href && href.includes("fonts.googleapis.com"))
        .map(rewriteOne),
    };
  }, { outputFileForRel, assetsRoot });
}

function renderPage({ pageInfo, navTree, pageMeta, prev, next, outputPath, outputDir }) {
  const currentOutputRelative = pageMeta.outputRelative;
  const nav = renderNavTree(navTree, currentOutputRelative);
  const indexHref = relativeUrl(outputPath, path.join(outputDir, "index.html"));
  const stylesheetHref = relativeUrl(outputPath, path.join(outputDir, "assets", "reader.css"));
  const fontLinks = [...new Set(pageInfo.fontLinks)].map((href) =>
    `<link rel="stylesheet" href="${escapeHtml(href)}">`
  ).join("\n");

  const prevLink = prev ? `<a href="${escapeHtml(relativeUrl(outputPath, prev.output))}">上一节：${escapeHtml(prev.title)}</a>` : "<span></span>";
  const nextLink = next ? `<a href="${escapeHtml(relativeUrl(outputPath, next.output))}">下一节：${escapeHtml(next.title)}</a>` : "<span></span>";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageInfo.title)}</title>
  ${fontLinks}
  <link rel="stylesheet" href="${escapeHtml(stylesheetHref)}">
</head>
<body>
  <div class="layout">
    <nav class="sidebar">
      <h1 class="sidebar-title"><a href="${escapeHtml(indexHref)}">Android Compose 基础</a></h1>
      ${nav}
    </nav>
    <main class="reader-shell">
      <article class="article">
        <a class="back-link" href="${escapeHtml(indexHref)}">返回目录</a>
        <h1 class="article-title">${escapeHtml(pageInfo.title)}</h1>
        ${pageInfo.body}
        <nav class="pager">${prevLink}${nextLink}</nav>
      </article>
    </main>
  </div>
</body>
</html>
`;
}

function renderIndex(navTree, pages) {
  const nav = renderNavTree(navTree);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Android Compose 基础</title>
  <link rel="stylesheet" href="assets/reader.css">
</head>
<body>
  <main class="home">
    <h1>Android Compose 基础</h1>
    <p>共 ${pages.length} 个章节。选择一个章节开始阅读。</p>
    ${nav}
  </main>
</body>
</html>
`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  const sourceDir = path.resolve(args.source);
  const outputDir = path.resolve(args.output);
  const assetsDir = path.resolve(args.assets);
  const outputPageDir = path.join(outputDir, "page");

  let inputFiles = await findHtmlFiles(sourceDir);
  if (args.limit) inputFiles = inputFiles.slice(0, args.limit);

  const pages = inputFiles.map((input) => {
    const relative = path.relative(sourceDir, input);
    const outputRelative = toPosix(path.join("page", relative));
    return {
      input,
      relative,
      output: path.join(outputPageDir, relative),
      outputRelative,
      title: pageTitleFromRelative(relative),
      unit: sectionTitleFromRelative(relative, 0),
      chapter: sectionTitleFromRelative(relative, 1),
    };
  });
  const navTree = buildTree(pages);

  await fs.mkdir(path.join(outputDir, "assets"), { recursive: true });
  await fs.writeFile(path.join(outputDir, "assets", "reader.css"), readableCss(), "utf8");

  const browser = await chromium.launch({ headless: true });
  const parsePage = await browser.newPage({ javaScriptEnabled: false });
  try {
    for (let index = 0; index < pages.length; index += 1) {
      const pageMeta = pages[index];
      console.log(`[${index + 1}/${pages.length}] ${toPosix(pageMeta.relative)}`);
      const pageInfo = await extractPage(parsePage, pageMeta.input, pageMeta.output, assetsDir);
      pageMeta.title = pageInfo.title || pageMeta.title;
      await fs.mkdir(path.dirname(pageMeta.output), { recursive: true });
      await fs.writeFile(pageMeta.output, renderPage({
        pageInfo,
        navTree,
        pageMeta,
        prev: pages[index - 1],
        next: pages[index + 1],
        outputPath: pageMeta.output,
        outputDir,
      }), "utf8");
    }
  } finally {
    await browser.close();
  }

  await fs.writeFile(path.join(outputDir, "index.html"), renderIndex(navTree, pages), "utf8");
  console.log(`\nReadable docs generated: ${path.join(outputDir, "index.html")}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
