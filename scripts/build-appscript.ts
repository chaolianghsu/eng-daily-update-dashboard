// scripts/build-appscript.ts
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist-appscript");
const OUT = join(ROOT, "appscript", "index.html");

// Read the JS bundle
const jsPath = join(DIST, "bundle.js");
if (!existsSync(jsPath)) {
  console.error("Error: dist-appscript/bundle.js not found. Run vite build first.");
  process.exit(1);
}
const jsContent = readFileSync(jsPath, "utf-8");

// Glob for CSS files
const cssFiles = readdirSync(DIST).filter(f => f.endsWith(".css"));
const cssContent = cssFiles.map(f => readFileSync(join(DIST, f), "utf-8")).join("\n");

// Generate self-contained HTML
const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>工程部 Daily Update Dashboard</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>📊</text></svg>" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&display=swap" rel="stylesheet" />
  <style>${cssContent}</style>
</head>
<body>
  <div id="root"></div>
  <script>${jsContent}</script>
</body>
</html>`;

writeFileSync(OUT, html);
console.log(`Generated ${OUT} (${(html.length / 1024).toFixed(0)} KB)`);
