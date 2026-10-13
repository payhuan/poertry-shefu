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

## 腾讯云 COS 实际试传（2026-10-13）

Cloudflare 登录未成功，改在腾讯云 COS 完成小分片试传。用户已自行开通 COS 并接受按量计费协议。

- 测试桶：`poetry-shefu-smoke-20261013-1505430510`，广州（`ap-guangzhou`），单 AZ。桶本身私有读写。
- 上传 `sample.json`、`manifest.json`、`LICENSE.txt`，三个对象设为公有读、私有写；标准存储。不启用 CDN、全球加速、日志、版本控制或其他付费附加功能。
- 分片：8 首作品、89 条诗句，16,127 字节。公开地址：[sample.json](https://poetry-shefu-smoke-20261013-1505430510.cos.ap-guangzhou.myqcloud.com/sample.json)。
- COS 控制台配置 CORS：Origin `*`；Methods `GET`、`HEAD`；Allow-Headers `*`；保留 Vary: Origin。没有开放跨域写入方法。Cloudflare 的 `_headers` 文件不能代替 COS 控制台 CORS 配置，因此没有上传它。
- 匿名 HTTPS 读取返回 200；携带本地 Origin 请求时，返回 `Access-Control-Allow-Origin: *`。下载字节数、作品数、诗句数与 SHA-256 均与本地清单一致。
- 浏览器从 `http://127.0.0.1:4174/` 读取 COS：页面明确显示“跨域读取通过”，SHA-256 校验通过；本次两文件读取与校验耗时约 403 ms，不能视为所有网络的速度承诺。
- 未上传测试 HTML，测试页由本地静态服务提供；COS 只存静态题库数据，不需要启用静态网站功能或运行服务端程序。
- 游戏仍使用已有题池与搜韵。试传没有迁移全量数据、没有切换正式判题逻辑，也没有验证最终游戏平台的 CSP/网络沙盒。

后续可将全量索引及作品按小分片存到 COS。正式发布前需要游戏的真实托管地址，以验证该页面允许访问此题库域名。存储免费额度仅抵扣适用的标准存储容量，请求和外网下载按实际用量计费；全量公开发布前应评估流量费用。
