# 网站

这个目录生成 [zgzj.heibox.cc](https://zgzj.heibox.cc)。仓库里其余的 Markdown 是内容，这里只放把它们做成网页的代码，网站不读本目录里的任何 Markdown。

- `build.mjs`：把仓库里的 Markdown 转成静态页面，输出到 `dist/`。网址就是仓库路径：`目录/文件.md` 对应 `/目录/文件`，目录里的 `README.md` 对应 `/目录/`；关于页 `/关于` 取 `site/about.md`，根目录的 `README.md` 不上网站
- `site.config.json`：站点副标题，以及各专辑的题记
- `public/`：样式、脚本、字体和表情图，原样复制进 `dist/`
- `wrangler.jsonc`：Cloudflare Worker 配置，纯静态资源，只绑 zgzj.heibox.cc，不开 workers.dev 地址

推送到 main 后，Cloudflare 自动构建部署。本地预览：

```bash
npm install
npm run dev
```

文章的写法约定：第一行 `# 标题`，第三行写「作者 · 日期」或只写日期，日期可以只到月份；转载的文字在作者行下写一行「原帖：网址」或「原文：网址」，页面会把原链接放在标题区；再往下以 `> **编者注**` 开头的引用块会排成编者注，编者注里可用四级标题标明引文出自谁，两段引文会左右对照，最后一段编者的话通栏排在下面。目录里放一个 `README.md` 就成为专辑，文件按文件名排序即阅读顺序。专辑下的子目录是一组连读篇目，编号与上下篇导航都在组内，并有自己的组页；有子目录时，直接放在专辑目录里的文章另成一组记录，组名取专辑 `README.md` 里的二级标题。文章里用到新的表情符号时，构建会提示缺哪张图，把对应的 Twemoji SVG 放进 `public/assets/emoji/` 即可。
