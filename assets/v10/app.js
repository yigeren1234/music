/* ============ 悦音 · 首页脚本 ============ */
(function () {
  "use strict";
  const cfg = window.SITE_CONFIG;
  const $ = (s) => document.querySelector(s);
  const audio = $("#audio");
  const player = $("#player");
  // 单曲专属链接模式：
  // ① index.html?song=曲目ID
  // ② 独立页地址（如 /music/126598 或 /music/126598/index.html）
  const pathMatch = location.pathname.match(/(?:^|\/)(\d{5,8})(?:\/index\.html)?\/?$/);
  const focusId = new URLSearchParams(location.search).get("song") || (pathMatch ? pathMatch[1] : "");
  // 由 <编号>/index.html 生成的独立页，静态资源在上一级目录
  const relBase = window.SONG_PAGE_BASE || "";

  let songs = [];
  let curCat = cfg.hideCustomerFromList ? "bgm" : "customer";
  let playingId = null;
  let focusMode = false; // 单曲专属链接模式

  /* ---------- 工具 ---------- */
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDur = (s) => {
    if (!s || !isFinite(s) || s <= 0) return "--:--";
    s = Math.round(s);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };
  const fmtSize = (b) =>
    b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  const fmtDate = (t) => new Date(t).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
  const fileUrl = (f) => cfg.cdnBase + f;
  // 备用通道：GitHub 官方接口直连（CDN 未就绪时自动使用）
  const ghRawUrl = (f) =>
    "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + f + "?ref=" + cfg.branch;
  async function fetchAudio(file) {
    try {
      const r = await fetch(fileUrl(file));
      if (r.ok) return r;
    } catch (e) { /* 尝试备用通道 */ }
    return fetch(ghRawUrl(file), { headers: { Accept: "application/vnd.github.raw" } });
  }
  const extOf = (f) => { const i = String(f).lastIndexOf("."); return i >= 0 ? String(f).slice(i) : ""; };
  const catOf = (k) => (cfg.cats.find((c) => c.key === k) || cfg.cats[0]);
  const byId = (id) => songs.find((s) => s.id === id);
  // 单曲链接可能传入 内部ID 或 数字编号，两者都能找到
  const findSong = (key) => songs.find((s) => s.id === key || s.code === key);
  let toastTimer = null;
  function toast(msg) {
    const old = $(".toast"); if (old) old.remove();
    const el = document.createElement("div");
    el.className = "toast"; el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  }

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7V5zm6 0h4v14h-4V5z"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    customer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    bgm: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 18.5a3 3 0 1 1-2-2.83V5.6a1 1 0 0 1 .76-.97l9-2.25A1 1 0 0 1 18 3.35v10.82a3 3 0 1 1-2-2.83V7.28l-7 1.75v9.47z"/></svg>',
    female: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-1 3h2v3h3v2h-3v2h-2v-2H8v-2h3v-3z"/></svg>',
    male: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 13a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-1 2h2v2h2v2h-2v3h-2v-3H9v-2h2v-2z"/></svg>'
  };

  /* ---------- 载入曲库 ---------- */
  async function load() {
    const grid = $("#grid");
    try {
      let res = await fetch(relBase + "index.json?t=" + Date.now());
      if (!res.ok) throw new Error("HTTP " + res.status);
      let data = await res.json();
      songs = (data.songs || []).sort((a, b) => b.up - a.up);
      // 单曲专属链接模式
      if (focusId) {
        focusMode = true;
        document.body.classList.add("focus-mode");
        // 若主数据源暂时没同步到这首（CDN 缓存延迟），自动改用 GitHub 实时接口再找一次
        if (!findSong(focusId)) {
          try {
            const freshUrl =
              "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo +
              "/contents/index.json?ref=" + cfg.branch;
            const r2 = await fetch(freshUrl, { headers: { Accept: "application/vnd.github+json" } });
            if (r2.ok) {
              const j2 = await r2.json();
              const decoded = JSON.parse(
                decodeURIComponent(escape(atob(String(j2.content).replace(/\s/g, ""))))
              );
              songs = (decoded.songs || []).sort((a, b) => b.up - a.up);
            }
          } catch (e2) { /* 保持原结果 */ }
        }
        const song = byId(focusId);
        if (!song) {
          grid.innerHTML =
            '<div class="loading">该音乐已下架或链接已更新<br>' +
            (cfg.contact || "") +
            '<br><span style="font-size:13px;opacity:.7">请向商家索取最新的音乐链接</span></div>';
          return;
        }
        document.title = song.title + " · " + cfg.siteName;
      }
      renderStats();
      renderGrid();
      setCat(curCat, true);
    } catch (e) {
      grid.innerHTML = '<div class="loading">音乐列表加载失败，请稍后刷新重试</div>';
    }
  }

  function renderStats() {
    $("#heroStats").innerHTML = "4 个栏目 · 共 <b>" + songs.length + "</b> 首曲目 · 免注册 · 直接下载";
    cfg.cats.forEach((c) => {
      const n = songs.filter((s) => s.cat === c.key).length;
      const el = $("#cnt-" + c.key);
      if (el) el.textContent = n;
    });
  }

  /* ---------- 渲染列表 ---------- */
  function renderGrid() {
    const grid = $("#grid");
    const list = focusMode
      ? songs.filter((s) => s.id === focusId || s.code === focusId)
      : songs.filter((s) => s.cat === curCat && !(cfg.hideCustomerFromList && s.cat === "customer"));
    $("#notice").hidden = true;
    if (!list.length) {
      grid.innerHTML = '<div class="loading">本栏目暂无音乐，敬请期待</div>';
      return;
    }
    grid.innerHTML = list.map((s) => {
      const isPlaying = playingId === s.id;
      const icon = ICONS[s.cat] || ICONS.bgm;
      return (
        '<div class="card' + (isPlaying ? " playing" : "") + '" data-id="' + esc(s.id) + '">' +
          '<div class="cover ' + catOf(s.cat).cls + '">' +
            '<div class="cover-icon">' + icon + "</div>" +
            '<button class="cover-btn" data-play="' + esc(s.id) + '" aria-label="播放">' +
              '<span class="cover-play">' + (isPlaying ? ICONS.pause : ICONS.play) + "</span>" +
            "</button>" +
            '<div class="eq"><span></span><span></span><span></span></div>' +
          "</div>" +
          '<div class="track-info">' +
            '<div class="track-title" title="' + esc(s.title) + '">' + esc(s.title) + "</div>" +
            '<div class="track-meta"><span>⏱ ' + fmtDur(s.dur) + "</span><span>" + fmtSize(s.size) + "</span><span>" + fmtDate(s.up) + "</span></div>" +
          "</div>" +
          '<div class="track-actions">' +
            '<button class="btn btn-play" data-play="' + esc(s.id) + '" aria-label="播放/暂停">' + (isPlaying ? ICONS.pause : ICONS.play) + "</button>" +
            '<button class="btn btn-dl" data-dl="' + esc(s.id) + '">' + ICONS.download + " 下载</button>" +
          "</div>" +
        "</div>"
      );
    }).join("");

    grid.querySelectorAll("[data-play]").forEach((b) => {
      b.addEventListener("click", () => play(b.getAttribute("data-play")));
    });
    grid.querySelectorAll("[data-dl]").forEach((b) => {
      b.addEventListener("click", () => download(b.getAttribute("data-dl"), b));
    });
  }

  /* ---------- 分类切换 ---------- */
  function setCat(cat, force) {
    if (curCat === cat && !force) return;
    curCat = cat;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.getAttribute("data-cat") === cat));
    document.querySelectorAll(".topnav a").forEach((a) => a.classList.toggle("active", a.getAttribute("data-cat") === cat));
    renderGrid();
  }

  /* ---------- 播放器 ---------- */
  function play(id) {
    const s = byId(id);
    if (!s) return;
    if (playingId === id) {
      if (audio.paused) audio.play().catch(() => toast("播放失败，请检查网络后重试"));
      else audio.pause();
      return;
    }
    playingId = id;
    audioFallbackUsed = false;
    audio.src = fileUrl(s.file);
    audio.play().catch(() => toast("播放失败，请检查网络后重试"));
    player.hidden = false;
    const cover = $("#pCover");
    cover.className = "p-cover " + catOf(s.cat).cls;
    cover.innerHTML = ICONS[s.cat] || ICONS.bgm;
    $("#pTitle").textContent = s.title;
    $("#pSub").textContent = catOf(s.cat).label + " · " + fmtDur(s.dur);
    $("#pDur").textContent = fmtDur(s.dur);
    $("#pCur").textContent = "0:00";
    $("#pFill").style.width = "0%";
    syncPlayIcons();
    renderGrid();
  }

  function syncPlayIcons() {
    const playing = !audio.paused && playingId;
    $("#pPlay .ic-play").hidden = playing;
    $("#pPlay .ic-pause").hidden = !playing;
    document.querySelectorAll("[data-play]").forEach((b) => {
      const id = b.getAttribute("data-play");
      if (id === playingId) {
        const btn = b.classList.contains("btn-play") ? b : b.querySelector(".cover-play");
        if (btn) btn.innerHTML = playing ? ICONS.pause : ICONS.play;
      }
    });
    document.querySelectorAll(".card").forEach((c) =>
      c.classList.toggle("playing", playing && c.getAttribute("data-id") === playingId)
    );
  }

  function step(dir) {
    if (!playingId) return;
    const cur = byId(playingId);
    if (!cur) return;
    const q = songs.filter((s) => s.cat === cur.cat);
    if (!q.length) return;
    let i = q.findIndex((s) => s.id === playingId);
    i = (i + dir + q.length) % q.length;
    play(q[i].id);
  }

  audio.addEventListener("play", syncPlayIcons);
  audio.addEventListener("pause", syncPlayIcons);
  audio.addEventListener("ended", () => step(1));
  audio.addEventListener("timeupdate", () => {
    if (!isFinite(audio.duration)) return;
    $("#pCur").textContent = fmtDur(audio.currentTime);
    $("#pDur").textContent = fmtDur(audio.duration);
    $("#pFill").style.width = (audio.currentTime / audio.duration) * 100 + "%";
  });
  let audioFallbackUsed = false; // 播放失败时自动切换备用通道（每首歌只尝试一次）
  audio.addEventListener("error", () => {
    if (playingId && !audioFallbackUsed) {
      const s = byId(playingId);
      if (s) {
        audioFallbackUsed = true;
        audio.src = ghRawUrl(s.file) + "&cb=" + Date.now();
        audio.play().catch(() => toast("播放失败，请稍后重试"));
        syncPlayIcons();
        return;
      }
    }
    toast("音频加载失败，请稍后重试");
  });

  $("#pPlay").addEventListener("click", () => (playingId ? play(playingId) : null));
  $("#pPrev").addEventListener("click", () => step(-1));
  $("#pNext").addEventListener("click", () => step(1));
  $("#pClose").addEventListener("click", () => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    playingId = null;
    player.hidden = true;
    syncPlayIcons();
    renderGrid();
  });
  $("#pBar").addEventListener("click", (e) => {
    if (!playingId || !isFinite(audio.duration)) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
  });

  /* ---------- 下载（带进度） ---------- */
  async function download(id, btn) {
    const s = byId(id);
    if (!s) return;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = "下载中 0%";
    try {
      const res = await fetchAudio(s.file);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const total = Number(res.headers.get("Content-Length")) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        if (total) btn.textContent = "下载中 " + Math.min(99, Math.round((got / total) * 100)) + "%";
      }
      const blob = new Blob(chunks, { type: res.headers.get("Content-Type") || "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = s.title + extOf(s.file);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      btn.textContent = "已下载 ✓";
      setTimeout(() => { btn.innerHTML = orig; }, 1600);
    } catch (e) {
      btn.innerHTML = orig;
      window.open(fileUrl(s.file), "_blank");
      toast("已在新窗口打开，请长按/右键保存");
    }
    btn.disabled = false;
  }

  /* ---------- 事件绑定与初始化 ---------- */
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => setCat(t.getAttribute("data-cat")))
  );
  document.querySelectorAll(".topnav a").forEach((a) =>
    a.addEventListener("click", () => setCat(a.getAttribute("data-cat")))
  );
  // 客户音乐专属链接模式：首页不展示该栏目入口与曲目
  if (cfg.hideCustomerFromList) {
    document
      .querySelectorAll('.tab[data-cat="customer"], .topnav a[data-cat="customer"]')
      .forEach((el) => { el.style.display = "none"; });
  }

  $("#brandName").textContent = cfg.siteName;
  $("#footerName").textContent = cfg.siteName;
  $("#heroSub").textContent = cfg.siteSub || $("#heroSub").textContent;
  $("#footerContact").textContent = cfg.contact || "";
  $("#year").textContent = new Date().getFullYear();
  document.title = cfg.siteName + " · 音乐库";

  load();
})();
