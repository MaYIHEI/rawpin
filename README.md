# rawpin

> 把任意图标洗成代理脚本任务图标的 PNG。三种来源,一键导出。

写 Surge / Loon / Quantumult X / Stash 脚本时,通知图标(tag icon)总要单独折腾——
搜应用 logo、裁正方、加圆角、压尺寸、命名,五步走完才能丢进 GitHub。

rawpin 把这五步压成一步:**App Store 搜名字 → 选图 → 下载**。任意图片 URL 或本地图也一样。

---

## 演示

| 输入 | 结果 |
|---|---|
| App Store 搜 `途虎养车` | 1024×1024 原图 → 裁 256×256 圆角 PNG → 文件名建议 `tuhu` |
| 粘 `wx27d20205249c56a3` | 抓微信公众平台公开 logo |
| 粘一张 logo 链接 | Worker 反代加载,绕跨域和防盗链 |
| 拖一张本地图 | 完全在浏览器里处理,不上传 |

---

## 为什么做这个

我维护几个代理脚本仓库([paperclip](https://github.com/MaYIHEI/paperclip)、[pin](https://github.com/MaYIHEI/pin)),每加一个脚本都得给它配一张任务图标。过去的流程是:

1. 去 App Store 截图 / Google 图搜
2. 丢 PS 裁正方、加圆角
3. 改文件名为全小写连字符
4. 上传到图标仓库

慢且烦。**rawpin 就是把这 4 步压成 1 步。**

面向**写代理脚本的人**——你写 Loon plugin、Surge module、QX rewrite,
任务行里那个 `img-url=`,从此不用自己 PS。

---

## 怎么用

打开 **[rawpin.pages.dev](https://rawpin.pages.dev)** *(或部署你自己的,见下)*。

三个 tab:

- **App Store** — 输入应用名、选地区、点结果卡片
- **微信小程序** — 输入 appid(`wxXXXXXXXXXXXXXXXX`),适用于插件型小程序
- **图片 URL** — 粘任意 https 图片地址
- **本地上传** — 拖文件进来或点选

载入后:

- 4 档尺寸:**128 / 256 / 512 / 1024**
- 圆角:0% 正方 → 22% iOS 默认 → 50% 圆形
- 文件名自动从 bundleId / 名字推断,可改
- **下载 PNG** / **复制图片** / **复制 base64**(便于贴到 GitHub Web 上传)
- 最近 6 次导出自动保留,下次回来直接点缩略图重新载入

---

## 自己部署一份

Cloudflare Pages,5 分钟,免费,无服务器。

1. Fork 本仓库
2. [Cloudflare Pages](https://dash.cloudflare.com/?to=/:account/pages) → Create → Connect to Git → 选你 fork 的仓库
3. 框架预设留空、构建命令留空,**构建输出目录填 `public`**
4. 保存并部署

部署完会拿到一个 `xxx.pages.dev` 域名。`functions/[[path]].js` 是 Pages Functions 约定路径,会自动识别,**两个 API 端点无需额外配置**。

---

## 工作原理

```
前端 (public/index.html)
 ├─ App Store tab  → /api/search-app  → iTunes Search API
 ├─ 微信小程序 tab  → /api/weapp-info  → 微信公众平台插件信息页 scrape
 ├─ URL tab        → /img?open=1      → Worker 反代任意 https 图片
 ├─ 上传 tab        → FileReader       → 不出网,纯浏览器处理
 └─ 编辑器          → canvas 裁切 → PNG → 下载 / 剪贴板 / base64

后端 (functions/[[path]].js)
 ├─ /api/search-app → 反代 iTunes,边缘缓存 600s
 ├─ /api/weapp-info → scrape mp.weixin.qq.com 公开信息页,边缘缓存 300s
 └─ /img            → 反代图片,加 CORS、改 Referer 绕防盗链
```

iTunes Search API 是 Apple 公开免登录端点。响应里有 `artworkUrl512`,URL 里把 `512x512bb` 替换成 `1024x1024bb` 即可拿到 1024 原图。

微信小程序数据来自 `mp.weixin.qq.com/wxopen/pluginbasicprofile` 这个公开页面(免登录),**只有插件型小程序能查**(类似途虎、泡泡玛特等)。

---

## 局限

- iTunes API 限速约 **20 次/分钟**。挂了 Cloudflare 边缘缓存,实测够用
- 不是所有应用都在 App Store——找不到就用"图片 URL"或"本地上传"
- SVG 上传后会被栅格化——这工具是给位图任务图标用的
- 没做 GitHub 一键 PR——pin 仓库还小,手动传更快;以后规模上来再加

---

## 相关项目

- [paperclip](https://github.com/MaYIHEI/paperclip) — 改自社区的代理脚本合集(签到自动化)
- [pin](https://github.com/MaYIHEI/pin) — 配套的 Loon/Surge 任务图标库

## License

[MIT](LICENSE)
