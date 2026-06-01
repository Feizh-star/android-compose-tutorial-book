const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const MENU_FILE = path.join(ROOT, 'menu.md');
const FETCH_SCRIPT = path.join(__dirname, 'fetch-single.js');

function safeName(title) {
  return title.replace(/[<>:"/\\|?*]/g, '');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Parse menu.md into three-level tree
function parseMenu(content) {
  const lines = content.split('\n');
  const units = [];
  let curUnit = null;
  let curChapter = null;
  let unitIdx = 0;
  let chapterIdx = 0;
  let sectionIdx = 0;

  for (const line of lines) {
    const m = line.match(/^(\s*)- \[(.+?)\]\((.+?)\)/);
    if (!m) continue;

    const indent = m[1].length;
    const title = m[2];
    const url = m[3];

    if (indent === 0) {
      unitIdx++;
      chapterIdx = 0;
      curUnit = { num: unitIdx, title: safeName(title), url, chapters: [] };
      units.push(curUnit);
      curChapter = null;
    } else if (indent === 2 && curUnit) {
      chapterIdx++;
      sectionIdx = 0;
      curChapter = { num: chapterIdx, title: safeName(title), url, sections: [] };
      curUnit.chapters.push(curChapter);
    } else if (indent === 4 && curChapter) {
      sectionIdx++;
      curChapter.sections.push({ num: sectionIdx, title: safeName(title), url });
    }
  }
  return units;
}

function main() {
  const content = fs.readFileSync(MENU_FILE, 'utf-8');
  const units = parseMenu(content);

  let total = 0;
  let done = 0;
  let failed = 0;

  for (const u of units) {
    for (const c of u.chapters) {
      total += c.sections.length;
    }
  }
  console.log(`Found ${units.length} units, ${total} sections\n`);

  for (const u of units) {
    const unitDir = path.join(ROOT, `${pad(u.num)}.${u.title}`);
    console.log(`\n=== ${pad(u.num)}.${u.title} ===`);

    for (const c of u.chapters) {
      const chapterDir = path.join(unitDir, `${pad(c.num)}.${c.title}`);

      for (const s of c.sections) {
        const outFile = path.join(chapterDir, `${pad(s.num)}.${s.title}.source.html`);
        const shortPath = `${pad(u.num)}.${u.title}/${pad(c.num)}.${c.title}/${pad(s.num)}.${s.title}.source.html`;

        if (fs.existsSync(outFile)) {
          console.log(`  SKIP: ${shortPath}`);
          done++;
          continue;
        }

        process.stdout.write(`  FETCH: ${shortPath} ... `);
        try {
          execSync(`node "${FETCH_SCRIPT}" "${s.url}" "${outFile}"`, {
            cwd: ROOT,
            stdio: 'pipe',
            timeout: 120000
          });
          console.log('OK');
          done++;
        } catch (err) {
          console.log('FAILED');
          console.error(`    ${err.stderr ? err.stderr.toString().trim() : err.message}`);
          failed++;
        }
      }
    }
  }

  console.log(`\n=== DONE: ${done} fetched, ${failed} failed, ${total} total ===`);
}

main();
