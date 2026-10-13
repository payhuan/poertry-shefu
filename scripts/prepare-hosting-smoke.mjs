import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const root = new URL('../', import.meta.url)
const output = new URL('dist-hosting-smoke/', root)
const seed = JSON.parse(await readFile(new URL('public/corpus/seed.json', root), 'utf8'))
const source = JSON.parse(await readFile(new URL('public/corpus/seed-manifest.json', root), 'utf8'))
const works = seed.works.slice(0, 8)
const ids = new Set(works.map(work => work.id))
const lines = seed.lines.filter(line => ids.has(line.poemId))
assert.equal(works.length, 8)
assert.ok(lines.length > 0)
assert.ok(works.every(work => ['唐', '宋'].includes(work.dynasty) && work.paragraphs.length))
const sample = JSON.stringify({ schemaVersion: 1, works, lines })
assert.ok(Buffer.byteLength(sample) < 100_000)
await mkdir(output, { recursive: true })
await writeFile(new URL('sample.json', output), sample)
await writeFile(new URL('manifest.json', output), JSON.stringify({
  schemaVersion: 1, sampleFile: 'sample.json', bytes: Buffer.byteLength(sample),
  sha256: createHash('sha256').update(sample).digest('hex'),
  works: works.length, lines: lines.length,
  source: { repository: source.repository, commit: source.commit, license: source.license },
}, null, 2))
await copyFile(new URL('public/corpus/LICENSE.txt', root), new URL('LICENSE.txt', output))
await writeFile(new URL('_headers', output), '/*\n  Access-Control-Allow-Origin: *\n  Access-Control-Allow-Methods: GET, HEAD, OPTIONS\n  X-Content-Type-Options: nosniff\n  Cache-Control: public, max-age=300\n')
await writeFile(new URL('index.html', output), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>诗词题库托管试验</title>
<style>body{max-width:720px;margin:40px auto;padding:20px;font:17px/1.8 system-ui;background:#f5f2e9;color:#23483c}input{box-sizing:border-box;width:100%;padding:12px}button{margin:16px 0;padding:12px 24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}label{display:block}</style>
<h1>诗词题库托管试验</h1><p>仅含 8 首唐宋作品。本页在本地打开、填写公开题库地址后，可测试跨域读取；在托管地址直接打开则测试同源读取。</p>
<label>题库 HTTPS 地址（留空使用本页地址）<input id="base" type="url" placeholder="粘贴实际部署地址"></label>
<button id="test">测试读取与校验</button><pre id="result" role="status">等待测试</pre>
<p>来源：chinese-poetry · MIT · <a href="LICENSE.txt">许可文件</a></p>
<script type="module">
const button = document.querySelector('#test'), result = document.querySelector('#result');
button.addEventListener('click', async () => {
  button.disabled = true; result.textContent = '正在读取…'; const started = performance.now();
  try {
    const raw = document.querySelector('#base').value.trim();
    const base = raw ? new URL(raw.endsWith('/') ? raw : raw + '/') : new URL('./', location.href);
    if (raw && base.protocol !== 'https:') throw Error('公开题库请使用 HTTPS 地址');
    async function get(name) { const response = await fetch(new URL(name, base), { signal: AbortSignal.timeout(15000), cache: 'no-store' }); if (!response.ok) throw Error('HTTP ' + response.status); return response; }
    const manifest = await (await get('manifest.json')).json(), bytes = await (await get('sample.json')).arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    const sample = JSON.parse(new TextDecoder().decode(bytes));
    if (bytes.byteLength !== manifest.bytes || hash !== manifest.sha256 || sample.works.length !== manifest.works || sample.lines.length !== manifest.lines) throw Error('分片校验失败');
    const first = sample.works[0];
    result.textContent = '读取及 SHA-256 校验成功\\n' + (base.origin === location.origin ? '同源读取（尚未证明跨域）' : '跨域读取通过') + '\\n' + manifest.works + ' 首作品，' + manifest.lines + ' 条诗句，' + bytes.byteLength + ' 字节\\n耗时 ' + Math.round(performance.now() - started) + ' ms\\n\\n' + first.author + '《' + first.title + '》\\n' + first.paragraphs.join('\\n');
  } catch (error) { result.textContent = '测试失败：' + error.message + '\\n请检查地址、网络、跨域配置和页面网络策略。'; }
  finally { button.disabled = false; }
});
</script></html>`)
console.log(`Prepared ${works.length} works, ${lines.length} lines, ${Buffer.byteLength(sample)} bytes in ${output.pathname}`)
