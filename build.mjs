import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/app.mjs'], bundle: true, minify: true,
  target: ['es2020'], platform: 'browser', format: 'esm', outfile: 'dist/app.js',
  legalComments: 'eof', sourcemap: false });
await copyFile('src/index.html', 'dist/index.html');
await copyFile('src/style.css', 'dist/style.css');
if (process.argv.includes('--pages')) {
  for (const file of ['index.html', 'app.js', 'style.css']) await copyFile(`dist/${file}`, file);
  await writeFile('.nojekyll', '');
}
