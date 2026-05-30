const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];
const outputFile = process.argv[3];

if (!inputFile || !outputFile) {
  console.error('Usage: node download-image.js <input-base64-txt> <output-image-path>');
  process.exit(1);
}

const content = fs.readFileSync(inputFile, 'utf-8');
const match = content.match(/data:image\/\w+;base64,([A-Za-z0-9+/=]+)/);

if (!match) {
  console.error('No base64 image data found in input file');
  process.exit(1);
}

const imgData = Buffer.from(match[1], 'base64');
const dir = path.dirname(outputFile);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.writeFileSync(outputFile, imgData);
console.log(`Saved ${imgData.length} bytes to ${outputFile}`);
