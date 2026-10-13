# Cloudflare Pages 小分片试传

本试验只发布 8 首已有公开作品、来源和许可、读取测试页，不上传全量数据、不修改游戏检索。

## 生成与上传

```powershell
node scripts/prepare-hosting-smoke.mjs
npx --yes wrangler@4.149.0 login
npx --yes wrangler@4.149.0 pages deploy dist-hosting-smoke
```

Wrangler 需要 Cloudflare 账号授权。首次上传选择新建独立的题库测试项目，生产分支设为 `master`，不要覆盖已有项目。也可以将 `dist-hosting-smoke` 内文件压成 ZIP，从 Cloudflare 的 Workers & Pages → 创建 Pages → Direct Upload 上传。

生成文件包括 `sample.json`、`manifest.json`、`LICENSE.txt`、`_headers` 和 `index.html`。JSON 字节数和 SHA-256 在测试页中校验；`_headers` 允许公开诗词数据跨域读取。生成目录、ZIP 及 Wrangler 缓存不提交 Git。

## 验证

1. 打开实际部署地址，点击测试；确认文件可读取并通过哈希校验。这一步是同源读取。
2. 本地执行 `python -m http.server 4174 --bind 127.0.0.1 --directory dist-hosting-smoke`。在 `http://127.0.0.1:4174/` 填写实际部署地址，点击测试，必须显示“跨域读取通过”。
3. 从游戏最终托管平台再读取同一分片，检查 CSP/网络沙盒是否允许此域名。本地跨域成功不能代替该平台验收。
4. 在用户实际网络和手机上检查速度；全部通过后再生成全量索引与分片。

未登录、未取得实际部署地址、或只通过本地测试时，不能宣称公网部署成功。

官方资料：[直接上传](https://developers.cloudflare.com/pages/get-started/direct-upload/)、[静态响应头配置](https://developers.cloudflare.com/pages/configuration/headers/)。
