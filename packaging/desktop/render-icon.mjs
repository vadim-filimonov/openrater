// Render packaging/desktop/icon.svg → icon.png (512×512, transparent).
// Dev tooling, not product code. Uses the repo's playwright-core with a
// Chrome-for-Testing binary; omitBackground preserves the alpha canvas.
//
//   node packaging/desktop/render-icon.mjs [path-to-chrome]
//
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const exec =
  process.argv[2] ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const svg = readFileSync(join(here, "icon.svg"), "utf8");
const browser = await chromium.launch({ executablePath: exec });
const page = await browser.newPage({
  viewport: { width: 512, height: 512 },
  deviceScaleFactor: 1,
});
await page.setContent(
  `<!doctype html><style>html,body{margin:0;background:transparent}</style>${svg}`,
);
await page.screenshot({
  path: join(here, "icon.png"),
  omitBackground: true,
});
await browser.close();
console.log("wrote", join(here, "icon.png"));
