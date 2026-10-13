import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/app.mjs'], bundle: true, minify: true,
  target: ['es2020'], platform: 'browser', format: 'esm', outfile: 'dist/app.js',
  legalComments: 'eof', sourcemap: false });
await copyFile('src/style.css', 'dist/style.css');
const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const js = await readFile('dist/app.js'), css = await readFile('dist/style.css');
const assets = { js: `assets/app-${hash(js)}.js`, css: `assets/style-${hash(css)}.css` };
await mkdir('dist/assets', { recursive: true });
await writeFile(`dist/${assets.js}`, js);
await writeFile(`dist/${assets.css}`, css);
const html = (await readFile('src/index.html', 'utf8')).replace('./app.js', `./${assets.js}`).replace('./style.css', `./${assets.css}`);
await writeFile('dist/index.html', html);
await writeFile('dist/asset-manifest.json', JSON.stringify(assets, null, 2) + '\n');
await cp('src/icons', 'dist/icons', { recursive: true });
if (process.argv.includes('--pages')) {
  await mkdir('assets', { recursive: true });
  // Preserve previously published hashes so cached HTML always finds its matching files.
  for (const file of ['index.html', 'app.js', 'style.css', 'asset-manifest.json', ...Object.values(assets)]) await copyFile(`dist/${file}`, file);
  await writeFile('.nojekyll', '');
  await cp('src/icons', 'icons', { recursive: true });
}
