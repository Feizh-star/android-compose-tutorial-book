/**
 * 使用示例（Windows）
 * 批量处理：node tools/fetch-source/fetch-all.js
 * 单个处理：node .\tools\fetch-source\fetch-single.js "https://developer.android.com/codelabs/basic-android-kotlin-compose-variables?hl=zh-cn" "docs\02.构建应用界面/03.与界面和状态交互\04.编写自动化测试.source.html"
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const PAGE_URL = process.argv[2];
if (!PAGE_URL) {
  console.error('Usage: node fetch-source.js <codelab-url> [output-path]');
  process.exit(1);
}
const OUTPUT_PATH = process.argv[3] || path.join(__dirname, '..', '..', 'test', 'index.html');

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  });

  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');

  // Capture the document request ID
  let docRequestId = null;
  cdp.on('Network.responseReceived', (ev) => {
    if (ev.type === 'Document' && !docRequestId) {
      docRequestId = ev.requestId;
    }
  });

  await page.goto(PAGE_URL, { waitUntil: 'networkidle0', timeout: 60000 });

  if (!docRequestId) {
    console.error('Failed to capture document request');
  } else {
    const { body, base64Encoded } = await cdp.send('Network.getResponseBody', { requestId: docRequestId });
    const rawHTML = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;

    const outDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, rawHTML, 'utf-8');
    console.log(`Saved ${rawHTML.length} bytes to ${path.relative(path.join(__dirname, '..', '..'), OUTPUT_PATH)}`);
  }

  await page.close();
  await browser.close();
}

main().catch(console.error);
