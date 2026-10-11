import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(gatewayRoot, '..');
const publicRoot = path.join(repoRoot, 'public');
const assetsRoot = path.join(gatewayRoot, 'assets');

await rm(assetsRoot, { recursive: true, force: true });
await mkdir(path.join(assetsRoot, 'landing'), { recursive: true });

let homepage = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
homepage = homepage
  .replaceAll('https://jiucaihezi.studio', 'https://api.jiucaihezi.studio')
  .replace('src="/logo.svg"', 'src="/landing/logo.svg"');

const styles = homepage.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const contentStart = homepage.indexOf('<!-- ===== Hero ===== -->');
const contentEnd = homepage.indexOf('<!-- ===== Footer ===== -->');
if (!styles || contentStart < 0 || contentEnd <= contentStart) {
  throw new Error('Could not extract the Studio homepage content and styles');
}

const homepageContent = homepage.slice(contentStart, contentEnd);
const embeddedHomepage = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="https://api.jiucaihezi.studio/" />
  <title>韭菜盒子Studio</title>
  <style>
${styles}
    html, body { min-height: 100%; }
    body { overflow-x: hidden; }
    .hero { padding-top: 40px; }
  </style>
</head>
<body>
${homepageContent}
</body>
</html>
`;
await mkdir(path.join(assetsRoot, 'homepage-content'), { recursive: true });
await writeFile(path.join(assetsRoot, 'homepage-content', 'index.html'), embeddedHomepage);

const landingFiles = [
  'IMG_5114.webp',
  'IMG_5107.webp',
  'IMG_5110.webp',
  'IMG_5113.webp',
  'IMG_5108.webp',
  'IMG_5111.webp',
  'douyinerweima.jpg',
  'guanfangweixin.jpg',
  'og-cover.jpg'
];

for (const filename of landingFiles) {
  await copyFile(
    path.join(publicRoot, 'landing', filename),
    path.join(assetsRoot, 'landing', filename)
  );
}

await copyFile(path.join(publicRoot, 'logo.svg'), path.join(assetsRoot, 'landing', 'logo.svg'));
await copyFile(path.join(publicRoot, 'favicon.svg'), path.join(assetsRoot, 'favicon.svg'));
await copyFile(path.join(publicRoot, 'apple-touch-icon.png'), path.join(assetsRoot, 'apple-touch-icon.png'));
await copyFile(path.join(publicRoot, 'legal.css'), path.join(assetsRoot, 'legal.css'));

for (const page of ['support', 'privacy', 'terms']) {
  await cp(path.join(publicRoot, page), path.join(assetsRoot, page), { recursive: true });
}

console.log(`Prepared API homepage assets in ${assetsRoot}`);
