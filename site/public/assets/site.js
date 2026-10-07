(function () {
  // 字号三档，与 heibox.cc 用同一个 localStorage 键，读者在两站的习惯一致
  var SCALES = [0.9, 1, 1.12];
  var buttons = document.querySelectorAll(".font-size button");
  var index = 1;
  try { var saved = localStorage.getItem("font-size-index"); if (saved !== null && SCALES[+saved]) index = +saved; } catch (e) {}
  function apply() {
    document.documentElement.style.setProperty("--font-scale", String(SCALES[index]));
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.size === index)); });
  }
  apply();
  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      index = +b.dataset.size;
      try { localStorage.setItem("font-size-index", String(index)); } catch (e) {}
      apply();
    });
  });

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

  // 目录高亮当前小标题
  var links = document.querySelectorAll(".toc a");
  if (links.length && "IntersectionObserver" in window) {
    var map = {};
    links.forEach(function (a) { map[decodeURIComponent(a.getAttribute("href").slice(1))] = a; });
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && map[e.target.id]) {
          if (current) current.classList.remove("is-active");
          current = map[e.target.id];
          current.classList.add("is-active");
        }
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    document.querySelectorAll(".prose h2[id], .prose h3[id]").forEach(function (h) { io.observe(h); });
  }
})();
