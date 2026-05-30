const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..', '..', 'docs');
const MENU_FILE = path.join(__dirname, '..', '..', 'menu.md');

// Parse menu.md into a tree structure
function parseMenu(content) {
  const lines = content.split('\n');
  const tree = [];
  let currentUnit = null;
  let currentPathway = null;

  for (const line of lines) {
    const unitMatch = line.match(/^- \[(第 \d+ 单元[^\]]+)\]\(([^)]+)\)/);
    if (unitMatch) {
      currentUnit = { title: unitMatch[1], url: unitMatch[2], pathways: [] };
      tree.push(currentUnit);
      continue;
    }
    const pathwayMatch = line.match(/^  - \[([^\]]+)\]\(([^)]+)\)/);
    if (pathwayMatch && currentUnit) {
      currentPathway = { title: pathwayMatch[1], url: pathwayMatch[2], chapters: [] };
      currentUnit.pathways.push(currentPathway);
      continue;
    }
    const chapterMatch = line.match(/^    - \[([^\]]+)\]\((https:\/\/developer\.android\.com\/codelabs\/[^)]+)\)/);
    if (chapterMatch && currentPathway) {
      currentPathway.chapters.push({ title: chapterMatch[1], url: chapterMatch[2] });
    }
  }
  return tree;
}

// Download an image through the browser's fetch (uses Chrome's proxy settings)
async function downloadImage(page, url, destPath) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const result = await page.evaluate(async (imgUrl) => {
    try {
      const res = await fetch(imgUrl);
      if (!res.ok) return { ok: false, msg: `HTTP ${res.status}` };
      const blob = await res.blob();
      const buf = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buf));
      return { ok: true, bytes };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  }, url);

  if (!result.ok) throw new Error(result.msg);
  fs.writeFileSync(destPath, Buffer.from(result.bytes));
}

// Generate directory name (safe for filesystem)
function safeName(title) {
  return title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '');
}

function dirName(number, title) {
  return `${String(number).padStart(2, '0')}.${safeName(title)}`;
}

// Scrape a single codelab page
async function scrapePage(browser, pageUrl, unitNum, pathwayNum, chapterNum, unitTitle, pathwayTitle, chapterTitle) {
  const label = `[${unitNum}.${pathwayNum}.${chapterNum}]`;
  console.log(`  ${label} ${chapterTitle}`);

  const page = await browser.newPage();
  try {
    await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('google-codelab-step', { timeout: 15000 });

    // Extract title from step 0
    const titleHTML = await page.evaluate(() => {
      const el = document.querySelector('google-codelab-step[step="0"] .codelab-title .token');
      return el ? el.outerHTML : '';
    });

    // Extract content from all steps
    const stepContents = await page.evaluate(() => {
      const steps = document.querySelectorAll('google-codelab-step');
      const results = [];
      steps.forEach((step) => {
        const inner = step.querySelector('.instructions .inner');
        if (inner) results.push(inner.innerHTML);
      });
      return results;
    });

    if (stepContents.length === 0) {
      console.log(`    ${label} WARNING: No step content`);
      return;
    }

    // Collect all image URLs
    const imgMap = new Map();
    stepContents.forEach(html => {
      const regex = /<img[^>]+src="([^"]+)"/g;
      let match;
      while ((match = regex.exec(html)) !== null) {
        const url = match[1];
        if (!imgMap.has(url)) {
          let filename;
          try {
            filename = path.basename(new URL(url).pathname);
          } catch {
            filename = path.basename(url.split('?')[0]);
          }
          imgMap.set(url, filename);
        }
      }
    });

    // Download images
    const imgKey = `${unitNum}.${pathwayNum}.${chapterNum}.${safeName(chapterTitle)}`;
    const imgDir = path.join(BASE_DIR, 'images', imgKey);

    if (imgMap.size > 0) {
      process.stdout.write(`    Images: ${imgMap.size}`);
      let di = 0;
      for (const [url, filename] of imgMap) {
        const destPath = path.join(imgDir, filename);
        if (!fs.existsSync(destPath)) {
          try {
            await downloadImage(page, url, destPath);
          } catch (e) {
            console.log(`\n    Download failed: ${filename} (${e.message})`);
          }
        }
        di++;
        process.stdout.write(`.`);
      }
      console.log(' done');
    }

    // Build final HTML with local image paths
    let bodyHTML = '';
    if (titleHTML) bodyHTML += `<h1>${titleHTML}</h1>\n`;

    stepContents.forEach((content, idx) => {
      let fixed = content;
      for (const [oldUrl, filename] of imgMap) {
        fixed = fixed.replaceAll(oldUrl, `../../images/${imgKey}/${filename}`);
      }
      bodyHTML += fixed;
      if (idx < stepContents.length - 1) bodyHTML += '\n<hr>\n';
    });

    // Create output directories
    const unitDir = dirName(unitNum, unitTitle);
    const pathwayDir = dirName(pathwayNum, pathwayTitle);
    const outputDir = path.join(BASE_DIR, unitDir, pathwayDir);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputFile = path.join(outputDir, `${String(chapterNum).padStart(2, '0')}.${safeName(chapterTitle)}.html`);

    const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${chapterTitle}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 2em; margin-bottom: 0.5em; }
  h2 { font-size: 1.5em; margin-top: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
  h3 { font-size: 1.2em; margin-top: 1.2em; }
  pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; height: auto; }
  .callout, .note, .warning, aside, .special { padding: 12px 16px; margin: 16px 0; border-left: 4px solid #ddd; background: #f9f9f9; border-radius: 0 8px 8px 0; }
  hr { margin: 2em 0; border: none; border-top: 2px dashed #ddd; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; }
</style>
</head>
<body>
${bodyHTML}
</body>
</html>`;

    fs.writeFileSync(outputFile, fullHTML, 'utf-8');

  } finally {
    await page.close();
  }
}

// Generate index.html with tree navigation
function generateIndex(tree) {
  function walk(items) {
    let html = '<ul>';
    items.forEach((unit, ui) => {
      const uNum = ui + 1;
      html += `<li><details><summary>第 ${uNum} 单元：${unit.title}</summary><ul>`;
      unit.pathways.forEach((pathway, pi) => {
        const pNum = pi + 1;
        html += `<li><details><summary>${pathway.title}</summary><ul>`;
        pathway.chapters.forEach((chapter, ci) => {
          const cNum = ci + 1;
          const fp = `${encodeURIComponent(dirName(uNum, unit.title))}/${encodeURIComponent(dirName(pNum, pathway.title))}/${encodeURIComponent(dirName(cNum, chapter.title))}.html`;
          html += `<li><a href="${fp}" target="content">${chapter.title}</a></li>`;
        });
        html += '</ul></li>';
      });
      html += '</ul></details></li>';
    });
    html += '</ul>';
    return html;
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Android Compose 开发基础 - 本地教程</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { display: flex; height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  #sidebar { width: 340px; min-width: 340px; background: #f8f9fa; border-right: 1px solid #ddd; overflow-y: auto; padding: 16px; }
  #sidebar h2 { font-size: 1.1em; margin-bottom: 16px; color: #333; }
  #sidebar ul { list-style: none; padding-left: 0; }
  #sidebar li { margin: 2px 0; }
  #sidebar summary { cursor: pointer; padding: 4px 0; font-weight: 500; color: #444; }
  #sidebar summary:hover { color: #1a73e8; }
  #sidebar details details { padding-left: 12px; }
  #sidebar details details summary { font-weight: 400; font-size: 0.95em; }
  #sidebar details details ul { padding-left: 18px; }
  #sidebar a { color: #555; text-decoration: none; font-size: 0.9em; display: block; padding: 2px 0; }
  #sidebar a:hover { color: #1a73e8; }
  #content { flex: 1; }
  iframe { width: 100%; height: 100%; border: none; }
</style>
</head>
<body>
<div id="sidebar">
<h2>Android Compose 开发基础</h2>
${walk(tree)}
</div>
<div id="content">
<iframe name="content" src="about:blank"></iframe>
</div>
</body>
</html>`;

  fs.writeFileSync(path.join(BASE_DIR, 'index.html'), html, 'utf-8');
  console.log('Generated: docs/index.html');
}

// Main
async function main() {
  console.log('=== Android Docs Scraper ===\n');

  const menuContent = fs.readFileSync(MENU_FILE, 'utf-8');
  const tree = parseMenu(menuContent);

  let totalChapters = 0;
  tree.forEach(u => u.pathways.forEach(p => totalChapters += p.chapters.length));
  console.log(`${tree.length} units, ${totalChapters} chapters\n`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  });

  let done = 0;
  let errors = 0;

  for (let ui = 0; ui < tree.length; ui++) {
    const unit = tree[ui];
    const unitNum = ui + 1;
    console.log(`\n=== Unit ${unitNum}: ${unit.title} ===`);

    for (let pi = 0; pi < unit.pathways.length; pi++) {
      const pathway = unit.pathways[pi];
      const pathwayNum = pi + 1;

      for (let ci = 0; ci < pathway.chapters.length; ci++) {
        const chapter = pathway.chapters[ci];
        const chapterNum = ci + 1;

        // Resume: skip if output file exists
        const outFile = path.join(BASE_DIR,
          dirName(unitNum, unit.title),
          dirName(pathwayNum, pathway.title),
          `${String(chapterNum).padStart(2, '0')}.${safeName(chapter.title)}.html`);

        if (fs.existsSync(outFile)) {
          console.log(`  [${unitNum}.${pathwayNum}.${chapterNum}] SKIP: ${chapter.title}`);
          done++;
          continue;
        }

        try {
          await scrapePage(browser, chapter.url, unitNum, pathwayNum, chapterNum,
            unit.title, pathway.title, chapter.title);
          done++;
        } catch (e) {
          console.log(`  [${unitNum}.${pathwayNum}.${chapterNum}] ERROR: ${e.message}`);
          errors++;
        }

        // Delay between pages
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  await browser.close();

  console.log('\n=== Generating index ===');
  generateIndex(tree);

  console.log(`\n=== DONE: ${done} chapters, ${errors} errors ===`);
}

main().catch(console.error);
