// 把仓库里的 Markdown 生成静态页面，输出到 dist/，由 Worker 的静态资源功能托管。
// 网址直接用仓库里的中文路径：a/b.md → /a/b，目录的 README.md → /a/，根目录 README.md → /关于。
import { Marked } from "marked";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(process.env.CONTENT_DIR || path.join(SITE_DIR, ".."));
const OUT_DIR = path.join(SITE_DIR, "dist");
const CONFIG = JSON.parse(fs.readFileSync(path.join(SITE_DIR, "site.config.json"), "utf8"));
const SECTIONS = JSON.parse(fs.readFileSync(path.join(SITE_DIR, "sections.json"), "utf8"));
const SITE_NAME = CONFIG.siteName;
const SITE_URL = "https://zgzj.heibox.cc";
const ABOUT_SLUG = "关于";
const SKIP_DIRS = new Set(["site", ".git", ".github", "node_modules"]);
const EMOJI_DIR = path.join(SITE_DIR, "public", "assets", "emoji");
const CHARS_PER_MINUTE = 500;
const REPO_URL = "https://github.com/Taoshuke/jianzheng";
const BUILD_DATE = new Date().toISOString().slice(0, 10).replace(/-/g, ".");

// ---------- 读取仓库 ----------

function walk(dir, rel = "") {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".") || SKIP_DIRS.has(ent.name)) continue;
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...walk(path.join(dir, ent.name), r));
    else out.push(r);
  }
  return out;
}

const files = walk(CONTENT_DIR);
const mdFiles = files.filter((f) => f.endsWith(".md"));
const readText = (rel) => fs.readFileSync(path.join(CONTENT_DIR, rel), "utf8").replace(/\r\n/g, "\n");

function urlFor(rel) {
  if (rel === "README.md") return `/${ABOUT_SLUG}`;
  if (rel.endsWith("/README.md")) return `/${rel.slice(0, -"README.md".length)}`;
  if (rel.endsWith(".md")) return `/${rel.slice(0, -3)}`;
  return `/${rel}`;
}
const encodeUrl = (u) => u.split("/").map(encodeURIComponent).join("/");
const outFileFor = (rel) => { const u = urlFor(rel); return u.endsWith("/") ? `${u}index.html` : `${u}.html`; };

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const stripTags = (h) => h.replace(/<[^>]+>/g, "");

// ---------- 表情：统一换成 Twemoji 图，Windows 上国旗才不会显示成两个字母 ----------

const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}️?/gu;
const missingEmoji = new Set();
function emojify(html) {
  return html.replace(EMOJI_RE, (e) => {
    const code = [...e].filter((c) => c !== "️").map((c) => c.codePointAt(0).toString(16)).join("-");
    if (!fs.existsSync(path.join(EMOJI_DIR, `${code}.svg`))) { missingEmoji.add(`${e} ${code}`); return e; }
    return `<img class="emoji" src="/assets/emoji/${code}.svg" alt="${e}" draggable="false">`;
  });
}
const plainTitle = (t) => t.replace(EMOJI_RE, "").trim();

// ---------- 解析文章 ----------

const BYLINE_RE = /^(?:(.+?) · )?(\d{4}-\d{2}(?:-\d{2})?)$/;

function parseArticle(rel) {
  const lines = readText(rel).split("\n");
  let title = path.basename(rel, ".md");
  let i = 0;
  if (lines[0]?.startsWith("# ")) { title = lines[0].slice(2).trim(); i = 1; }
  while (lines[i] === "") i++;
  let author = null, date = null;
  const by = BYLINE_RE.exec(lines[i] || "");
  if (by) { author = by[1] || null; date = by[2]; i++; }
  while (lines[i] === "") i++;
  let note = null;
  if ((lines[i] || "").startsWith("> **编者注**")) {
    const buf = [];
    while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^> ?/, ""));
    note = buf.join("\n").replace(/^\*\*编者注\*\*[\s　]*/, "");
  }
  const body = lines.slice(i).join("\n").trim();
  const firstPara = body.split(/\n\n/).find((p) => p && !/^(#|!\[|>|-|\|)/.test(p)) || "";
  const summary = firstPara.replace(/\*\*|`|\[|\]\([^)]*\)/g, "").slice(0, 140);
  const textLen = body.replace(/!\[[^\]]*\]\([^)]*\)|[#>*`\-|]|\s/g, "").length;
  return {
    rel, url: urlFor(rel), title, author, date, note, body, summary,
    minutes: Math.max(1, Math.round(textLen / CHARS_PER_MINUTE)),
    folder: rel.includes("/") ? rel.split("/")[0] : null,
  };
}

// ---------- 编者分节：按 sections.json 给长文插小标题，原文不动 ----------

function applySections(rel, body) {
  const entries = SECTIONS[rel];
  if (!entries) return { body, edited: false, promoted: false };
  const lines = body.split("\n");
  let from = 0, edited = false, promoted = false;
  for (const e of entries) {
    // 按顺序往后找，同样开头的段落出现两次时取前一个分节之后的那个
    const idx = lines.findIndex((l, i) => i >= from && l.replace(/^>\s?/, "").trimStart().startsWith(e.before));
    if (idx < 0) { console.warn(`分节找不到插入位置：${rel}「${e.before}」`); continue; }
    const quote = lines[idx].startsWith(">") ? "> " : "";
    const hashes = "#".repeat(e.level || 2);
    if (e.title) {
      lines.splice(idx, 0, `${quote}${hashes} ${e.title}`, quote.trim());
      from = idx + 3;
      edited = true;
    } else {
      const m = /^(?:>\s?)?\*\*(.+)\*\*\s*$/.exec(lines[idx]);
      if (!m) { console.warn(`分节要升级的不是整段加粗：${rel}「${e.before}」`); continue; }
      lines[idx] = `${quote}${hashes} ${m[1].trim()}`;
      from = idx + 1;
      promoted = true;
    }
  }
  return { body: lines.join("\n"), edited, promoted };
}

// ---------- Markdown 渲染 ----------

const slugify = (text) => stripTags(text).replace(/[\s　]+/g, "-").replace(/[、，。：；？！“”（）《》,.:;?!"()]/g, "").toLowerCase();

function makeMarked(fromRel, headings) {
  const baseDir = path.posix.dirname(fromRel);
  const resolve = (href) => {
    if (/^(?:[a-z]+:|#|\/)/i.test(href)) return href;
    const [p, hash = ""] = href.split("#");
    let target = path.posix.normalize(path.posix.join(baseDir === "." ? "" : baseDir, decodeURIComponent(p)));
    target = target.endsWith(".md") ? urlFor(target) : `/${target}`;
    return encodeUrl(target) + (hash ? `#${hash}` : "");
  };
  const m = new Marked({ gfm: true });
  m.use({
    renderer: {
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:/i.test(href);
        return `<a href="${esc(resolve(href))}"${title ? ` title="${esc(title)}"` : ""}${external ? ' rel="noopener" target="_blank"' : ""}>${text}</a>`;
      },
      image({ href, text }) {
        return `<img src="${esc(resolve(href))}" alt="${esc(text || "")}" loading="lazy">`;
      },
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        let id = slugify(html);
        for (let n = 2; headings.some((h) => h.id === id); n++) id = `${slugify(html)}-${n}`;
        if (depth >= 2 && depth <= 4) headings.push({ id, depth, html });
        return `<h${depth} id="${esc(id)}">${html}</h${depth}>\n`;
      },
    },
  });
  return m;
}

function renderMd(md, fromRel, headings = []) {
  return emojify(makeMarked(fromRel, headings).parse(md));
}

// 截图记录类的页面（截图在前、引用块说明在后，反复出现）排成时间线：
// 每组「说明 + 截图」成为一个节点，说明在上，截图在下
const isImagePara = (t) => t.type === "paragraph" && t.tokens.every((x) => x.type === "image" || (x.type === "text" && !x.text.trim()));
function renderTimeline(md, fromRel) {
  const m = makeMarked(fromRel, []);
  const tokens = m.lexer(md);
  const imgCount = tokens.filter(isImagePara).length;
  const quoteCount = tokens.filter((t) => t.type === "blockquote").length;
  if (imgCount < 6 || quoteCount < 4) return null;
  const parse = (toks) => emojify(m.parser(Object.assign(toks, { links: tokens.links })));
  const intro = [], items = [];
  let shots = [];
  let started = false;
  for (const t of tokens) {
    if (isImagePara(t)) { started = true; shots.push(t); continue; }
    if (t.type === "space") continue;
    if (!started) { intro.push(t); continue; }
    if (t.type === "blockquote") { items.push({ caption: parse(t.tokens), shots: parse(shots) }); shots = []; continue; }
    items.push({ caption: parse([t]), shots: parse(shots) }); shots = [];
  }
  if (shots.length) items.push({ caption: "", shots: parse(shots) });
  const list = items.map((it, n) => `<li class="tl-item">
  <span class="tl-index">${String(n + 1).padStart(2, "0")}</span>
  ${it.caption ? `<div class="tl-caption">${it.caption}</div>` : ""}
  ${it.shots ? `<div class="tl-shots">${it.shots}</div>` : ""}
</li>`).join("\n");
  return `${parse(intro)}<ol class="timeline">${list}</ol>`;
}

// ---------- 标题用衬线字体：构建时按页面实际用到的字向 Google Fonts 取子集，自托管 ----------

async function fetchSerifSubset(text, weight, outName) {
  const chars = [...new Set(text.replace(/\s/g, ""))].join("");
  const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@${weight}&display=swap&text=${encodeURIComponent(chars)}`;
  try {
    const css = await (await fetch(cssUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36" } })).text();
    const fontUrl = /url\((https:[^)]+)\)/.exec(css)?.[1];
    if (!fontUrl) throw new Error("响应里没有字体地址");
    const buf = Buffer.from(await (await fetch(fontUrl)).arrayBuffer());
    fs.mkdirSync(path.join(OUT_DIR, "assets", "fonts"), { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, "assets", "fonts", outName), buf);
    return `@font-face{font-family:"Jianzheng Serif";font-weight:${weight};font-display:swap;src:url("/assets/fonts/${outName}") format("woff2")}`;
  } catch (e) {
    // 取不到时退回系统衬线字体，页面照常可用
    console.warn(`衬线字体子集 ${weight} 获取失败，改用系统字体：${e.message}`);
    return "";
  }
}

// ---------- 页面骨架 ----------

const folderNames = [...new Set(mdFiles.filter((f) => f.endsWith("/README.md")).map((f) => f.split("/")[0]))];
// 页面不设页头：每页正文上方一行面包屑，从「首页」起，对应仓库里的目录层级
const HOME_CRUMB = `<a href="/">首页</a><span class="crumb-sep" aria-hidden="true">/</span>`;

const fmtDate = (d) => (d ? d.replace(/-/g, ".") : "");

function layout({ title, description = "", url, main, bodyClass = "" }) {
  const fullTitle = title ? `${plainTitle(title)} — ${SITE_NAME}` : `${SITE_NAME} · ${CONFIG.tagline}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="${title ? "article" : "website"}">
<meta property="og:title" content="${esc(title ? plainTitle(title) : SITE_NAME)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(SITE_URL + encodeUrl(url))}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta name="theme-color" content="#fafaf8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#161616" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/favicon.png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/site.css">
<link rel="alternate" type="application/atom+xml" title="${SITE_NAME}" href="/feed.xml">
<script>try{var i=localStorage.getItem("font-size-index");if(i!==null)document.documentElement.style.setProperty("--font-scale",[0.86,0.95,1.06][+i]||0.95)}catch(e){}</script>
</head>
<body class="${bodyClass}">
<a class="skip-link" href="#main">跳到正文</a>
<div class="progress" aria-hidden="true"><span></span></div>
<main id="main">${main}</main>
<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-cols">
      <section><h2 class="footer-head">本站</h2><ul>
        <li><a href="${encodeUrl(`/${ABOUT_SLUG}`)}">关于本站</a></li>
        <li><a href="/feed.xml">RSS 订阅</a></li>
        <li><a href="${REPO_URL}">GitHub 仓库</a></li>
      </ul></section>
      <section><h2 class="footer-head">参与</h2><ul>
        <li><a href="${REPO_URL}/issues/new">提出异议或补充材料</a></li>
        <li class="footer-note">引用请注明出处，并附上原文链接</li>
      </ul></section>
    </div>
    <div class="footer-base">
      <p><a href="https://heibox.cc">黑盒之美<span aria-hidden="true"> ↗</span></a><span>更新于 ${BUILD_DATE}</span><span>表情图 <a href="https://github.com/jdecked/twemoji">Twemoji</a> CC-BY 4.0</span></p>
      <a class="to-top" href="#">回到顶部</a>
    </div>
  </div>
</footer>
<a class="to-top-btn" href="#" title="回到顶部" aria-label="回到顶部"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
<div class="font-size" role="group" aria-label="字号">
  <button type="button" data-size="0" aria-label="小号字" aria-pressed="false">字</button>
  <button type="button" data-size="1" aria-label="中号字" aria-pressed="true">字</button>
  <button type="button" data-size="2" aria-label="大号字" aria-pressed="false">字</button>
</div>
<script src="/assets/site.js" defer></script>
</body>
</html>
`;
}

// ---------- 生成 ----------

fs.mkdirSync(OUT_DIR, { recursive: true });
// 只清空目录内容不删目录本身：Windows 上 wrangler dev 监视着 dist，删目录会报 EPERM
for (const ent of fs.readdirSync(OUT_DIR)) fs.rmSync(path.join(OUT_DIR, ent), { recursive: true, force: true });
fs.cpSync(path.join(SITE_DIR, "public"), OUT_DIR, { recursive: true });

const write = (outRel, html) => {
  const p = path.join(OUT_DIR, outRel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
};

for (const f of files.filter((f) => !f.endsWith(".md"))) {
  const p = path.join(OUT_DIR, f);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.copyFileSync(path.join(CONTENT_DIR, f), p);
}

const articles = mdFiles.filter((f) => !f.endsWith("README.md")).map(parseArticle);
const byRel = Object.fromEntries(articles.map((a) => [a.rel, a]));
const byName = (a, b) => (a.rel < b.rel ? -1 : 1);

// 专辑：目录里的文章按文件名排，即阅读顺序；目录 README 里链到的目录外文章算作「另见」
const collections = {};
for (const name of folderNames) {
  const readmeRel = `${name}/README.md`;
  const src = readText(readmeRel).replace(/^# .*\n+/, "");
  const parts = src.split(/\n(?:- .*\n?)+/);
  const intro = (parts[0] || "").trim();
  const outro = parts.slice(1).join("\n").trim();
  const companions = [...outro.matchAll(/\]\(([^)]+\.md)\)/g)]
    .map((m) => path.posix.normalize(path.posix.join(name, decodeURIComponent(m[1]))))
    .map((r) => byRel[r]).filter(Boolean);
  collections[name] = {
    name, intro, companions,
    items: articles.filter((a) => a.folder === name).sort(byName),
    ...(CONFIG.collections?.[name] || {}),
  };
}
const companionOf = {};
for (const c of Object.values(collections)) for (const a of c.companions) companionOf[a.rel] = c;

// ----- 片段 -----

function contentsList(c, currentRel = null) {
  return `<ol class="contents">${c.items.map((a, n) => `<li${a.rel === currentRel ? ' class="is-current" aria-current="page"' : ""}>
  <a href="${encodeUrl(a.url)}"><span class="contents-no">${String(n + 1).padStart(2, "0")}</span><span class="contents-title">${emojify(esc(a.title))}</span><time class="contents-date">${fmtDate(a.date)}</time></a>
</li>`).join("")}</ol>`;
}

function companionsLine(c) {
  if (!c.companions.length) return "";
  return `<p class="companions"><span class="label">另见</span>${c.companions.map((a) => `<a href="${encodeUrl(a.url)}">${emojify(esc(a.title))}</a>`).join("")}</p>`;
}

// 专辑抬头：专辑名和题记，不做大横幅；专辑页上方留一行「首页 /」面包屑
function collectionHead(c, { asPageTitle = false } = {}) {
  const name = asPageTitle ? `<h1 class="collection-title">${esc(c.name)}</h1>` : `<h2 class="collection-title"><a href="${encodeUrl(`/${c.name}/`)}">${esc(c.name)}</a></h2>`;
  return `<header class="collection-head">
  ${asPageTitle ? `<p class="kicker">${HOME_CRUMB}</p>` : ""}
  ${name}
  ${c.epigraph ? `<p class="epigraph">${esc(c.epigraph)}${c.epigraphSource ? `<cite>${esc(c.epigraphSource)}</cite>` : ""}</p>` : ""}
</header>`;
}

function indexRow(a, number = null) {
  const kicker = a.folder || (companionOf[a.rel] ? `${companionOf[a.rel].name} · 另见` : "");
  return `<li class="index-row">
  <a href="${encodeUrl(a.url)}">
    ${number ? `<span class="index-no">${String(number).padStart(2, "0")}</span>` : `<time class="index-date">${fmtDate(a.date)}</time>`}
    <div class="index-body">
      ${number ? `<p class="kicker">${a.author ? `文／${esc(a.author)} · ` : ""}${fmtDate(a.date)}</p>` : kicker || a.author ? `<p class="kicker">${esc(kicker)}${kicker && a.author ? " · " : ""}${a.author ? `文／${esc(a.author)}` : ""}</p>` : ""}
      <h3 class="index-title">${emojify(esc(a.title))}</h3>
      ${a.summary ? `<p class="index-summary">${esc(a.summary)}</p>` : ""}
    </div>
    <span class="index-arrow" aria-hidden="true">→</span>
  </a>
</li>`;
}

// ----- 文章页 -----

for (const a of articles) {
  const headings = [];
  const timeline = renderTimeline(a.body, a.rel);
  const { body: sectioned, edited, promoted } = applySections(a.rel, a.body);
  const bodyHtml = timeline || renderMd(sectioned, a.rel, headings);
  const c = a.folder ? collections[a.folder] : null;
  const idx = c ? c.items.indexOf(a) : -1;
  const next = c && idx < c.items.length - 1 ? c.items[idx + 1] : null;
  const prev = c && idx > 0 ? c.items[idx - 1] : null;
  const home = companionOf[a.rel];
  const kicker = c
    ? `<a href="${encodeUrl(`/${c.name}/`)}">${esc(c.name)}</a><span>${String(idx + 1).padStart(2, "0")} / ${String(c.items.length).padStart(2, "0")}</span>`
    : home ? `<a href="${encodeUrl(`/${home.name}/`)}">${esc(home.name)}</a><span>另见</span>` : "";
  // 目录：宽屏挂在正文右侧，窄屏放在编者注下面，可展开收起
  let toc = "", tocInline = "";
  if (headings.length >= 2) {
    const top = Math.min(...headings.map((h) => h.depth));
    // 原文自带小标题（Markdown 标题或被升级的加粗分节句）时，注明只是「部分」由编者所加
    const hadOwn = promoted || /^#{2,4} /m.test(a.body);
    const note = edited ? `<p class="toc-note">${hadOwn ? "部分" : ""}小标题为编者所加</p>` : "";
    // 按层级拼成嵌套列表：顶层编号，下一层挂在所属的顶层节下面，再下一层挂在它下面
    const tree = [];
    for (const h of headings) {
      const node = { h, children: [] };
      const level = h.depth - top;
      let parent = tree;
      for (let l = 0; l < level && parent.length; l++) parent = parent[parent.length - 1].children;
      parent.push(node);
    }
    const renderNodes = (nodes, level) => `<ol class="toc-list toc-list--${level}">${nodes.map((n, i) => `<li class="toc-item">
      <a href="#${esc(n.h.id)}">${level === 0 ? `<span class="toc-no">${String(i + 1).padStart(2, "0")}</span>` : ""}<span class="toc-text">${n.h.html}</span></a>${n.children.length ? renderNodes(n.children, level + 1) : ""}</li>`).join("")}</ol>`;
    const list = renderNodes(tree, 0);
    toc = `<aside class="toc" aria-label="本文目录"><div class="toc-inner">
      <p class="toc-head"><span>目录</span><span class="toc-count">${tree.length} 节</span></p>
      ${list}
      ${note}<a class="toc-top" href="#">回到顶部</a>
    </div></aside>`;
    tocInline = `<details class="toc-inline"><summary>目录<span>${tree.length} 节</span></summary>${note}${list}</details>`;
  }
  const seriesEnd = c ? `<section class="series-end">
  ${next ? `<a class="next-up" href="${encodeUrl(next.url)}"><span class="kicker">下一篇 · ${String(idx + 2).padStart(2, "0")}</span><span class="next-title">${emojify(esc(next.title))}</span><span class="next-summary">${esc(next.summary)}</span></a>`
    : `<div class="next-up next-up--done"><span class="kicker">专辑读完了</span><span class="next-title">${esc(c.name)}</span>${companionsLine(c)}</div>`}
  <div class="series-all"><p class="kicker">${esc(c.name)} · 全部 ${c.items.length} 篇</p>${contentsList(c, a.rel)}</div>
  ${prev ? `<p class="prev-link"><a href="${encodeUrl(prev.url)}">← 上一篇：${emojify(esc(prev.title))}</a></p>` : ""}
</section>` : home ? `<section class="series-end"><div class="series-all"><p class="kicker">${esc(home.name)} · ${home.items.length} 篇</p>${contentsList(home)}</div></section>` : "";

  // 只走系统分享面板，浏览器不支持时按钮保持 hidden，由 site.js 判断后显示
  const shareBtn = (label, cls) => `<button class="share-btn${cls}" type="button" data-share-title="${esc(a.title)}" hidden><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M5 11.5V20h14v-8.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${label}</span></button>`;
  const main = `<article class="article${timeline ? " article--timeline" : ""}${toc ? " article--toc" : ""}">
  ${toc}
  <header class="article-head">
    <p class="kicker kicker--article">${HOME_CRUMB}${kicker}</p>
    <h1 class="article-title">${emojify(esc(a.title))}</h1>
    <p class="byline">${a.author ? `<span>文／${esc(a.author)}</span>` : ""}${a.date ? `<time>${fmtDate(a.date)}</time>` : ""}<span>约 ${a.minutes} 分钟读完</span>${shareBtn("分享", "")}</p>
  </header>
  ${a.note ? `<aside class="editor-note"><p class="editor-note-label">编者注</p>${renderMd(a.note, a.rel)}</aside>` : ""}
  ${tocInline}
  <div class="article-grid">
    <div class="prose">${bodyHtml}</div>
  </div>
  <div class="share-end">${shareBtn("分享这篇文章", " share-btn--end")}</div>
  ${seriesEnd}
</article>`;
  write(outFileFor(a.rel), layout({ title: a.title, description: a.summary, url: a.url, main, bodyClass: "is-article" }));
}

// ----- 专辑页 -----

for (const c of Object.values(collections)) {
  const main = `<section class="section section--first">
  ${collectionHead(c, { asPageTitle: true })}
  <ol class="index">${c.items.map((a, n) => indexRow(a, n + 1)).join("")}</ol>
  ${companionsLine(c)}
</section>`;
  write(`${c.name}/index.html`, layout({ title: c.name, description: c.epigraph || stripTags(renderMd(c.intro, `${c.name}/README.md`)), url: `/${c.name}/`, main }));
}

// ----- 首页 -----

const readme = readText("README.md");
const lead = (readme.replace(/^# .*\n+/, "").split(/\n\n/)[0] || "").trim();

// 首页导语：纯文字，依据 README 另写给网站读者的，存在 site.config.json 的 intro 里；
// 文中提到 GitHub 的地方链到仓库的 Issue 页
const homeIntro = CONFIG.intro.map((p) => `<p class="home-lead">${esc(p).replace("GitHub", `<a href="${REPO_URL}/issues">GitHub</a>`)}</p>`).join("\n  ");
const latest = [...articles].sort((a, b) => (a.date === b.date ? byName(a, b) : a.date < b.date ? 1 : -1));
write("index.html", layout({
  title: "",
  description: CONFIG.intro[0],
  url: "/",
  main: `<header class="home-head">
  <div class="home-title-row">
    <h1 class="home-title" aria-label="${esc(SITE_NAME)}">
      <picture><source srcset="/assets/logo/moon-dark.svg" media="(prefers-color-scheme: dark)"><img class="home-moon" src="/assets/logo/moon.svg" alt=""></picture>
      <picture><source srcset="/assets/logo/wordmark-dark.svg" media="(prefers-color-scheme: dark)"><img class="home-wordmark" src="/assets/logo/wordmark.svg" alt="${esc(SITE_NAME)}"></picture>
    </h1>
    <p class="home-meta"><span>${esc(CONFIG.tagline)}</span><span>${articles.length} 篇 · 更新于 ${BUILD_DATE}</span></p>
  </div>
  ${homeIntro}
</header>
${Object.values(collections).map((c) => `<section class="section">${collectionHead(c)}${contentsList(c)}${companionsLine(c)}</section>`).join("\n")}
<section class="section">
  <h2 class="section-title"><span>全部文章</span><span class="section-count">${articles.length}</span></h2>
  <ol class="index">${latest.map((a) => indexRow(a)).join("")}</ol>
</section>`,
}));

// ----- 订阅源（Atom）：全文输出，日期只到月份的按当月 1 日计 -----

const isoDate = (d) => `${d.length === 7 ? `${d}-01` : d}T00:00:00Z`;
const absUrl = (u) => SITE_URL + encodeUrl(u);
const xmlEsc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
// 订阅里的站内链接、图片都要写成完整网址，阅读器里才打得开
const absolutize = (html) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${SITE_URL}/`);
const feedItems = latest.filter((a) => a.date).map((a) => {
  const html = absolutize((a.note ? `<p><strong>编者注</strong>　</p>${renderMd(a.note, a.rel)}<hr>` : "") + (renderTimeline(a.body, a.rel) || renderMd(a.body, a.rel)));
  return `  <entry>
    <title>${xmlEsc(plainTitle(a.title))}</title>
    <link href="${absUrl(a.url)}"/>
    <id>${absUrl(a.url)}</id>
    <updated>${isoDate(a.date)}</updated>
    ${a.author ? `<author><name>${xmlEsc(a.author)}</name></author>` : ""}
    <summary>${xmlEsc(a.summary)}</summary>
    <content type="html">${xmlEsc(html)}</content>
  </entry>`;
});
fs.writeFileSync(path.join(OUT_DIR, "feed.xml"), `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-CN">
  <title>${SITE_NAME}</title>
  <subtitle>${xmlEsc(CONFIG.tagline)}</subtitle>
  <link href="${SITE_URL}/"/>
  <link rel="self" href="${SITE_URL}/feed.xml"/>
  <id>${SITE_URL}/</id>
  <updated>${new Date().toISOString()}</updated>
  <author><name>${SITE_NAME}</name></author>
${feedItems.join("\n")}
</feed>
`);

// ----- 关于、404 -----

write(`${ABOUT_SLUG}.html`, layout({
  title: ABOUT_SLUG, description: lead, url: `/${ABOUT_SLUG}`, bodyClass: "is-article",
  main: `<article class="article article--page"><p class="kicker kicker--article">${HOME_CRUMB}<span>关于</span></p><div class="prose">${renderMd(readme, "README.md")}</div></article>`,
}));
write("404.html", layout({
  title: "找不到页面", url: "/404",
  main: `<section class="not-found"><p class="kicker">404</p><h1>这个页面不存在</h1><p>可能已经改名或移走了。</p><a class="button" href="/">回到首页</a></section>`,
}));

// ----- 字体子集：收集所有用衬线显示的文字 -----

const serifText = [
  "篇目全部文章下一篇专辑读完了目录编者注这个页面不存在关于另见从第一篇读起",
  CONFIG.tagline,
  ...articles.map((a) => a.title),
  ...Object.values(collections).flatMap((c) => [c.name, c.epigraph || ""]),
  ...articles.flatMap((a) => [...a.body.matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1])),
  ...[...readme.matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1]),
  "0123456789",
].join("");
const faces = (await Promise.all([
  fetchSerifSubset(serifText, 700, "serif-700.woff2"),
])).join("\n");
fs.writeFileSync(path.join(OUT_DIR, "assets", "fonts.css"), faces + "\n");

if (missingEmoji.size) console.warn("缺少表情图，请下载到 public/assets/emoji/：", [...missingEmoji].join("，"));
console.log(`生成 ${articles.length} 篇文章、${Object.keys(collections).length} 个专辑页`);
