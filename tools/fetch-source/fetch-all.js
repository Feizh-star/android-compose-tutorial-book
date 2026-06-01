const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FETCH_SCRIPT = path.join(__dirname, 'fetch-single.js');

function usage() {
  console.log(`Usage:
  node tools/build-readable-docs.js [options]

Options:
  --input <dir>        menu md file path. Default: "menu.md"
  --output <dir>       Output directory. Default: ""
  --help               Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    input: "menu.md",
    output: "",
    help: false,
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
  return args;
}

function safeName(title) {
  return title.replace(/[<>:"/\\|?*]/g, '');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function parseMenu(content) {
  const lines = content.split('\n');
  const root = { children: [] };
  const stack = [{ node: root, indent: -2 }];

  for (const line of lines) {
    const m = line.match(/^(\s*)- \[(.+?)\]\((.+?)\)/);
    if (!m) continue;

    const indent = m[1].length;
    const title = m[2];
    const url = m[3];

    const node = { title: safeName(title), url, children: [] };

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].node;
    node.num = parent.children.length + 1;
    parent.children.push(node);

    stack.push({ node, indent });
  }

  return root.children;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }
  const cwd = process.cwd()
  const INPUT_FILE = path.join(cwd, args.input);
  const OUTPUT_DIR_PATH = path.join(cwd, args.output);

  const content = fs.readFileSync(INPUT_FILE, 'utf-8');
  const nodes = parseMenu(content);

  let done = 0;
  let failed = 0;

  function countLeafNodes(list) {
    let n = 0;
    for (const item of list) {
      if (item.children.length === 0) n++;
      else n += countLeafNodes(item.children);
    }
    return n;
  }

  function maxDepth(list) {
    let d = 0;
    for (const item of list) {
      if (item.children.length > 0) d = Math.max(d, 1 + maxDepth(item.children));
    }
    return d;
  }

  const total = countLeafNodes(nodes);
  console.log(`Found ${total} items to fetch (max nesting: ${maxDepth(nodes) + 1} levels)\n`);

  function processNodes(list, parentPath) {
    for (const node of list) {
      const name = `${pad(node.num)}.${node.title}`;

      if (node.children.length > 0) {
        processNodes(node.children, path.join(parentPath, name));
      } else {
        const outFile = path.join(parentPath, `${name}.source.html`);
        const shortPath = path.relative(cwd, outFile);

        if (fs.existsSync(outFile)) {
          console.log(`  SKIP: ${shortPath}`);
          done++;
          continue;
        }

        process.stdout.write(`  FETCH: ${shortPath} ... `);
        try {
          execSync(`node "${FETCH_SCRIPT}" "${node.url}" "${outFile}"`, {
            cwd,
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

  processNodes(nodes, OUTPUT_DIR_PATH);

  console.log(`\n=== DONE: ${done} fetched, ${failed} failed, ${total} total ===`);
}

main();
