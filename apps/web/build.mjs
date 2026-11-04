import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('apps/web/dist', { recursive: true });
for (const [entry, tpl, out] of [
  ['apps/web/src/main.ts', 'apps/web/template.html', 'apps/web/dist/sasaki.html'],
  ['apps/web/src/online.ts', 'apps/web/online.template.html', 'apps/web/dist/online.html'],
]) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'iife', target: 'es2020', minify: true, charset: 'utf8', write: false });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  let html = readFileSync(tpl, 'utf8').replace('/*__BUNDLE__*/', () => js);
  // 서버가 직접 내려주는 온라인 페이지는 문서 머리말을 직접 붙인다 (시험판은 게시 시 자동으로 붙음)
  if (out.endsWith('online.html')) {
    html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}*,*::before,*::after{box-sizing:border-box}</style>
</head><body>${html}</body></html>`;
  }
  writeFileSync(out, html);
  console.log('built', out, (html.length / 1024).toFixed(1) + 'KB');
}
