(function () {
  // 字号三档，与 heibox.cc 用同一个 localStorage 键，读者在两站的习惯一致
  var SCALES = [0.86, 0.95, 1.06];
  var NAMES = ["小", "中", "大"];
  var dock = document.querySelector(".fs-dock");
  var tog = dock.querySelector(".fs-dock-tog");
  var steps = dock.querySelectorAll("[data-step]");
  var nameEl = dock.querySelector(".fs-dock-name");
  var index = 1;
  try { var saved = localStorage.getItem("font-size-index"); if (saved !== null && SCALES[+saved]) index = +saved; } catch (e) {}
  function apply() {
    document.documentElement.style.setProperty("--font-scale", String(SCALES[index]));
    nameEl.textContent = NAMES[index];
    steps[0].disabled = index === 0;
    steps[1].disabled = index === SCALES.length - 1;
  }
  apply();
  steps.forEach(function (b) {
    b.addEventListener("click", function () {
      index = Math.min(SCALES.length - 1, Math.max(0, index + +b.dataset.step));
      try { localStorage.setItem("font-size-index", String(index)); } catch (e) {}
      apply();
    });
  });
  function setOpen(open) { dock.classList.toggle("open", open); tog.setAttribute("aria-expanded", String(open)); if (open) dock.classList.remove("away"); }
  tog.addEventListener("click", function () { setOpen(!dock.classList.contains("open")); });
  document.addEventListener("pointerdown", function (e) { if (!dock.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });

  // 往下读正文时字号钮和回到顶部一起让开，往回翻或到页首页尾再出现
  var floaters = [dock, document.querySelector(".to-top-btn")].filter(Boolean);
  var lastY = window.scrollY;
  window.addEventListener("scroll", function () {
    var y = window.scrollY;
    var atEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 40;
    var away = y > lastY && y > 120 && !atEnd && !dock.classList.contains("open");
    floaters.forEach(function (el) { el.classList.toggle("away", away); });
    lastY = y;
  }, { passive: true });

  // 分享：调用系统分享面板，不支持的浏览器不显示按钮
  if (navigator.share) {
    document.querySelectorAll(".share-btn").forEach(function (b) {
      b.hidden = false;
      b.addEventListener("click", function () {
        var url = location.href.split("#")[0];
        // 读者在面板里点取消会以 AbortError 结束，这不是错误
        navigator.share({ title: b.dataset.shareTitle, url: url }).catch(function (e) { if (e.name !== "AbortError") throw e; });
      });
    });
  }

  // 阅读进度：按正文区块计算，读到正文末尾即满
  var prose = document.querySelector(".is-article .prose");
  var bar = document.querySelector(".progress");
  if (prose && bar) {
    var ticking = false;
    var update = function () {
      ticking = false;
      var r = prose.getBoundingClientRect();
      var total = r.height - window.innerHeight * 0.6;
      var p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 1;
      bar.style.setProperty("--progress", p.toFixed(4));
    };
    var onScroll = function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  // 目录：读到哪一节，就展开那一节的顶层条目并高亮当前小标题
  var links = document.querySelectorAll(".toc a[href^='#']");
  if (links.length && "IntersectionObserver" in window) {
    var map = {};
    links.forEach(function (a) { var id = a.getAttribute("href").slice(1); if (id) map[decodeURIComponent(id)] = a; });
    var current = null;
    var setActive = function (a) {
      if (current === a) return;
      document.querySelectorAll(".toc .is-active, .toc .is-open").forEach(function (el) { el.classList.remove("is-active", "is-open"); });
      current = a;
      a.classList.add("is-active");
      for (var li = a.parentElement; li && li.classList && li.classList.contains("toc-item"); li = li.parentElement.closest(".toc-item")) li.classList.add("is-open");
    };
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting && map[e.target.id]) setActive(map[e.target.id]); });
    }, { rootMargin: "-15% 0px -75% 0px" });
    document.querySelectorAll(".prose h2[id], .prose h3[id], .prose h4[id]").forEach(function (h) { io.observe(h); });
    var first = document.querySelector(".toc .toc-list--0 > .toc-item > a");
    if (first) setActive(first);
  }
  // 回到顶部：平滑滚动；系统设了减少动态效果时直接跳
  var topBtn = document.querySelector(".to-top-btn");
  if (topBtn) topBtn.addEventListener("click", function (e) {
    e.preventDefault();
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });
})();
