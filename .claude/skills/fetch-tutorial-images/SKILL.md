---
name: fetch-tutorial-images
description: >
  Downloads all content images from the current browser page to a local image/ directory
  and returns their markdown reference paths. Trigger when images need to be downloaded
  from a tutorial/Codelab page during the note-taking workflow, or when the user asks to
  save images from the current page for local markdown notes.
disable-model-invocation: false
---

# fetch-tutorial-images — Download Page Images for Markdown Notes

## Overview

From the currently open browser page (Playwright), extract all content images inside `<article>`, download them to a local `image/` directory, and return each image's markdown reference path with the correct relative depth (e.g. `../../image/filename.png` for notes two levels deep).

This skill assumes a note-taking directory structure where markdown notes live at `unit/chapter/note.md` and images are stored in an `image/` directory at the project root.

## Skill Arguments

```
/fetch-tutorial-images [imageDir] [relativeDepth]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `imageDir` | `image` | Output directory for downloaded images, relative to project root |
| `relativeDepth` | `../../` | Relative path prefix from a note file to the image directory |

**Examples:**
- `/fetch-tutorial-images` — downloads to `image/` with `../../` prefix (default for `unit/chapter/note.md`)
- `/fetch-tutorial-images assets/img ../` — downloads to `assets/img/` with `../` prefix (for notes one level deep)

## Prerequisites

- **Playwright MCP browser** — a page must already be navigated to the target URL
- **Node.js** — for running the `download-image.js` helper script

## Helper Script

This skill ships with a `download-image.js` script. It reads a text file containing a base64 data URL (produced by `browser_evaluate`) and decodes it to a binary image file.

Usage:
```
node download-image.js <input-base64-txt> <output-image-path>
```

The script auto-creates parent directories as needed.

## Workflow

### Step 1: Extract image info from the page

Call `browser_evaluate` to list all images inside `<article>`:

```json
{
  "function": "() => { const imgs = document.querySelectorAll('article img'); return Array.from(imgs).map((img, i) => ({ index: i, src: img.src, alt: img.alt || '' })); }"
}
```

The result is a JSON array. If the array is empty, there are no images — stop and report this.

### Step 2: Download each image

For each image in the array, fetch it via the browser and encode as base64. This step produces one temporary text file per image (the `browser_evaluate` tool auto-saves large results):

```json
{
  "function": "async () => { const imgs = document.querySelectorAll('article img'); const img = imgs[INDEX]; const response = await fetch(img.src); const blob = await response.blob(); const reader = new FileReader(); return new Promise((resolve) => { reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); }); }"
}
```

> Replace `INDEX` with the current image index from Step 1. The result (a `data:image/...;base64,...` string) will be saved to a temporary file path returned in the tool output — use that path in the next step.

### Step 3: Decode and save each image

Run the bundled `download-image.js` script to extract the base64 data and write the binary image:

```bash
node download-image.js "<temp-file-path>" "<project-root>/<imageDir>/<filename>"
```

> **filename**: extract from the original URL's last path segment, stripping any query string. E.g. `https://example.com/img/abc123.png?hl=zh-cn` → `abc123.png`.

### Step 4: Generate markdown references

For each downloaded image, produce a markdown image reference using the configured `relativeDepth`:

```markdown
![alt text](<relativeDepth><imageDir>/<filename>)
```

Example with defaults (`relativeDepth=../../`, `imageDir=image`):
```markdown
![Course authors photo](../../image/3e52bdd2663adeac.png)
```

### Step 5: Return the complete mapping

Return a summary table for use when writing the markdown note:

| index | original URL | local file | markdown ref |
|-------|-------------|------------|--------------|
| 0 | `https://...img/abc.png` | `abc.png` | `![alt](../../image/abc.png)` |

## Important Notes

- Only images inside the `<article>` element are processed — page chrome, headers, and footers are excluded.
- If the page has no `<article>` element, fall back to `document.querySelectorAll('main img')`.
- The `browser_evaluate` results for base64 encoding are large. The tool auto-saves them to temp files — use those file paths, do not try to inline the base64 content.
- Images that fail to fetch (CORS, 404) should be skipped with a warning rather than aborting the entire batch.

## Worked Example

Starting from `https://developer.android.com/codelabs/basic-android-kotlin-compose-before-you-begin?hl=zh-cn`:

**Step 1** — Extract images:
```
Result: [{ index: 0, src: "https://developer.android.com/static/.../3e52bdd2663adeac.png?hl=zh-cn", alt: "Course authors" }]
```

**Step 2** — Fetch image 0 as base64:
```
Result saved to: C:\Users\...\tool-results\mcp-playwright-browser_evaluate-1780046795481.txt
```

**Step 3** — Decode and save:
```
$ node download-image.js "C:\Users\...\tool-results\mcp-playwright-browser_evaluate-1780046795481.txt" "f:/Android/note/image/3e52bdd2663adeac.png"
Saved 277102 bytes to f:/Android/note/image/3e52bdd2663adeac.png
```

**Step 4/5** — Markdown reference:
```markdown
![Course authors](../../image/3e52bdd2663adeac.png)
```
