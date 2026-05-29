# Android 开发教程本地笔记库

## 项目说明

将官方 [Android 之 Compose 开发基础](https://developer.android.com/courses/android-basics-compose/unit-1?hl=zh-cn) 教程文档整理成本地 markdown 知识库。

课程目录参见 [menu.md](menu.md)。

## 目录结构

```
单元目录/章节目录/笔记.md
```

示例：`1.您的首个 Android 应用/Kotlin 简介/01.准备工作.md`

### 文件命名规则

- md 笔记文件以两位数字序号开头，按 [menu.md](menu.md) 中该章节下的出现顺序编号。
- 格式：`NN.标题.md`，例如 `01.准备工作.md`、`02.您的首个 Kotlin 程序.md`。

## 图片规范

- 图片按笔记文件分类管理，每个 md 笔记的图片存放在 `image/NN.标题/` 子目录中。
- md 文件中图片以相对路径引用，从笔记文件到 `image/` 需要两级 `../`：

  ```
  ../../image/NN.标题/图片文件名.png
  ```

  因为路径结构为 `unit/chapter/note.md`，往上两级才到根目录，`image/` 在根目录下。
- 图片文件名保持原始文件名不重命名。
- 同一张图被多个笔记引用时，分别存入各自的目录（避免跨笔记的耦合依赖）。
- **路径中不得包含空格**：`image/` 子目录名和 md 中的图片引用路径均不得含空格，否则 Markdown 渲染可能无法正确解析。
- **图片居中并设置宽度**：使用 HTML `<div>` 包裹图片，宽度为原网页中图片的 `displayWidth`（通过 `img.clientWidth` 获取），格式如下：

  ```html
  <div align="center">
  <img src="../../image/NN.标题/xxx.png" width="网页中实际宽度">
  </div>
  ```
  
  下载图片时同时记录每张图片的 `displayWidth`（`img.clientWidth`），写入笔记时使用该宽度值。
- **图片必须按原网页位置插入**：对比 `browser_evaluate` 提取的带 `[IMG_N]` 标记的页面结构，确保每张图片出现在与原文相同的段落之间，不遗漏不跳过。

## 内容处理规则

- 每个笔记完整复制对应小节网页的正文内容。
- **跳过**网页开头的"关于此 Codelab"版块（包含更新时间、编写团队等元信息）。
- 保留原文中的超链接。
- 图片使用 node 脚本 `download-image.js` 下载（从浏览器 evaluate 输出的 base64 结果文件中提取）。

## 工作流程

1. 使用 Playwright 浏览器打开目标 Codelab 页面。
2. **一次性提取完整文本**：使用 `browser_evaluate` 提取 `<article>` 的 `innerText`，比逐节点击 `browser_snapshot` 更高效：
   ```
   () => { const a = document.querySelector('article'); const c = a.cloneNode(true); c.querySelectorAll('nav, script, style').forEach(e => e.remove()); return c.innerText; }
   ```
3. `browser_evaluate` 提取 `<article>` 内所有图片的 URL（保存到 `.playwright-mcp/page-imgs.txt`）。
4. **批量并行下载图片**：每轮并行 3 张图片——
   - 并行调用 3 次 `browser_evaluate`（各 fetch 一张图并 base64 编码）；
   - 再并行调用 `node download-image.js` 保存这 3 张。
   - 重复至全部下载完。重复 URL 的图片（同一张图被引用多次）只下载一次，后续跳过。
5. 运行 `node .claude/skills/fetch-tutorial-images/download-image.js <临时文件> <目标图片路径>` 保存图片。
6. 编写 md 笔记文件，图片引用使用 `../../image/xxx.png` 相对路径。

## 效率提示

- 优先用 `browser_evaluate` 一次性提取 `<article>` 全部文本，避免逐节点击 snapshoto，大幅减少 Playwright 调用次数。
- 图片下载时并行 3 张一组（fetch+save），充分利用等待时间。
- `browser_evaluate` 返回结果较大时使用 `filename` 参数保存到 `.playwright-mcp/` 目录，避免内联传输。
- `download-image.js` 脚本路径统一用 `.claude/skills/fetch-tutorial-images/download-image.js`（相对于项目根目录）。
