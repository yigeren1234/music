/* ============ 悦音 · 后台管理脚本 ============ */
(function () {
  "use strict";
  const APP_VER = "v4";
  const cfg = window.SITE_CONFIG;
  const IS_LOCAL = cfg.isLocal;
  const $ = (s) => document.querySelector(s);
  const preview = $("#preview");

  let pat = localStorage.getItem("pat") || "";
  let authed = sessionStorage.getItem("admin_ok") === "1";
  let songs = [];
  let curCat = "bgm";
  let pickFile = null;
  let pickDur = 0;
  let previewId = null;
  let uploading = false;
  let indexSha = null;                     // 最近一次已知的 index.json 校验值（免去重复读取）
  let indexBusy = Promise.resolve();       // 曲库更新串行队列

  const TOKEN_RE = /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/;

  /* ---------- 令牌加解密（PBKDF2-SHA256 + AES-256-GCM，与 encrypt-pat.mjs 一致） ---------- */
  const b64ToBuf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bufToB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  async function deriveAesKey(password, salt) {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64ToBuf(salt), iterations: 120000, hash: "SHA-256" },
      km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }
  async function decryptPat(password) {
    const c = cfg.patEnc;
    const key = await deriveAesKey(password, c.salt);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(c.iv) }, key, b64ToBuf(c.data));
    return new TextDecoder().decode(pt);
  }
  async function encryptPat(password, token) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey2(password, salt);
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
    return { salt: bufToB64(salt), iv: bufToB64(iv), data: bufToB64(data) };
  }
  async function deriveAesKey2(password, saltBytes) {
    const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: 120000, hash: "SHA-256" },
      km, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
    );
  }

  /* ---------- 工具 ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDur = (s) => { if (!s || !isFinite(s) || s <= 0) return "--:--"; s = Math.round(s); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const fmtSize = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  const fmtDate = (t) => new Date(t).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
  const catLabel = (k) => (cfg.cats.find((c) => c.key === k) || { label: k }).label;
  const catCls = (k) => (cfg.cats.find((c) => c.key === k) || { cls: "c-bgm" }).cls;
  const fileUrl = (f) => cfg.cdnBase + f;
  const extOf = (f) => { const i = String(f).lastIndexOf("."); return i >= 0 ? String(f).slice(i) : ""; };
  let toastTimer = null;
  function toast(msg) {
    const old = $(".toast"); if (old) old.remove();
    const el = document.createElement("div");
    el.className = "toast"; el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3200);
  }

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7V5zm6 0h4v14h-4V5z"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 18.5a3 3 0 1 1-2-2.83V5.6a1 1 0 0 1 .76-.97l9-2.25A1 1 0 0 1 18 3.35v10.82a3 3 0 1 1-2-2.83V7.28l-7 1.75v9.47z"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
  };

  /* ---------- GitHub API ---------- */
  function ghHeaders() {
    return {
      Authorization: "Bearer " + pat,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }
  function friendlyError(status, msg) {
    if (status === 401) return "令牌无效或已过期：请点右上角「退出」后重新输入密码登录";
    if (status === 403) return "权限不足或请求过于频繁，请稍后再试";
    if (status === 404) return "仓库或文件不存在，请检查部署是否完成";
    if (status === 409) return "数据有冲突，请刷新页面后重试";
    if (status === 422) return "请求被拒绝（" + (msg || "422") + "）";
    return msg || "请求失败（HTTP " + status + "）";
  }
  async function ghApi(path, method, body, allow404) {
    const res = await fetch(cfg.apiBase + path, {
      method, headers: ghHeaders(),
      body: body ? JSON.stringify(body) : undefined
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).message || ""; } catch (e) { /* ignore */ }
      throw new Error(friendlyError(res.status, msg));
    }
    return res.json();
  }
  function ghUpload(path, body, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", cfg.apiBase + path);
      Object.keys(ghHeaders()).forEach((k) => x.setRequestHeader(k, ghHeaders()[k]));
      x.setRequestHeader("Content-Type", "application/json");
      x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) {
          let parsed = null;
          try { parsed = JSON.parse(x.responseText); } catch (e2) { /* ignore */ }
          return resolve(parsed);
        }
        let msg = "";
        try { msg = JSON.parse(x.responseText).message || ""; } catch (e) { /* ignore */ }
        reject(new Error(friendlyError(x.status, msg)));
      };
      x.onerror = () => reject(new Error("网络错误，请检查网络后重试"));
      x.send(JSON.stringify(body));
    });
  }
  const decodeB64 = (b64) => decodeURIComponent(escape(atob(String(b64).replace(/\s/g, ""))));
  const encodeB64 = (s) => btoa(unescape(encodeURIComponent(s)));

  function ghPath(p) { return "/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + p; }

  /* ---------- 载入曲库 ---------- */
  async function loadIndex() {
    const list = $("#list");
    try {
      let data = { songs: [] };
      if (IS_LOCAL) {
        const r = await fetch("index.json?t=" + Date.now());
        if (r.ok) data = await r.json();
      } else {
        const j = await ghApi(ghPath("index.json") + "?ref=" + cfg.branch, "GET", null, true);
        if (j) { indexSha = j.sha; data = JSON.parse(decodeB64(j.content)); }
      }
      songs = (data.songs || []).sort((a, b) => b.up - a.up);
      renderTabs();
      renderList();
    } catch (e) {
      list.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + "</div>";
    }
  }

  function renderTabs() {
    document.querySelectorAll(".atab").forEach((t) => {
      const n = songs.filter((s) => s.cat === t.getAttribute("data-cat")).length;
      t.textContent = catLabel(t.getAttribute("data-cat")) + " (" + n + ")";
    });
  }

  function renderList() {
    const list = $("#list");
    const arr = songs.filter((s) => s.cat === curCat);
    if (!arr.length) {
      list.innerHTML = '<div class="empty">「' + esc(catLabel(curCat)) + '」暂无音乐，上传后自动出现在首页</div>';
      return;
    }
    list.innerHTML = arr.map((s) => {
      const playing = previewId === s.id && !preview.paused;
      return (
        '<div class="row' + (playing ? " playing" : "") + '" data-id="' + esc(s.id) + '">' +
          '<button class="row-cover ' + catCls(s.cat) + '" data-play="' + esc(s.id) + '">' + (playing ? ICONS.pause : ICONS.play) + "</button>" +
          '<div class="row-info">' +
            '<div class="row-title" title="' + esc(s.title) + '">' + esc(s.title) + "</div>" +
            '<div class="row-meta">' + fmtDur(s.dur) + " · " + fmtSize(s.size) + " · " + fmtDate(s.up) + "</div>" +
          "</div>" +
          '<div class="row-actions">' +
            '<button class="btn btn-ghost btn-sm" data-ren="' + esc(s.id) + '">' + ICONS.edit + " 改名</button>" +
            '<button class="btn btn-ghost btn-sm" data-dl="' + esc(s.id) + '">' + ICONS.download + " 下载</button>" +
            '<button class="btn btn-danger btn-sm" data-del="' + esc(s.id) + '">' + ICONS.trash + " 删除</button>" +
          "</div>" +
        "</div>"
      );
    }).join("");

    list.querySelectorAll("[data-play]").forEach((b) =>
      b.addEventListener("click", () => togglePreview(b.getAttribute("data-play"))));
    list.querySelectorAll("[data-ren]").forEach((b) =>
      b.addEventListener("click", () => renameSong(b.getAttribute("data-ren"))));
    list.querySelectorAll("[data-dl]").forEach((b) =>
      b.addEventListener("click", () => adminDownload(b.getAttribute("data-dl"), b)));
    list.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => deleteSong(b.getAttribute("data-del"), b)));
  }

  function togglePreview(id) {
    const s = songs.find((x) => x.id === id);
    if (!s) return;
    if (previewId === id) {
      if (preview.paused) preview.play().catch(() => toast("播放失败"));
      else preview.pause();
      renderList();
      return;
    }
    previewId = id;
    preview.src = fileUrl(s.file);
    preview.play().catch(() => toast("播放失败"));
    renderList();
  }
  preview.addEventListener("pause", renderList);
  preview.addEventListener("play", renderList);

  async function adminDownload(id, btn) {
    const s = songs.find((x) => x.id === id);
    if (!s) return;
    const orig = btn.innerHTML;
    btn.textContent = "下载中…";
    try {
      const res = await fetch(fileUrl(s.file));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = s.title + extOf(s.file);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      btn.innerHTML = orig;
    } catch (e) {
      btn.innerHTML = orig;
      window.open(fileUrl(s.file), "_blank");
    }
  }

  /* ---------- 更新 index.json（线上模式，串行队列 + 冲突自动重试） ---------- */
  async function applyIndex(mutator) {
    for (let attempt = 0; attempt < 6; attempt++) {
      let data, sha = null;
      if (indexSha) {
        // 用内存中的最新曲库与校验值，省去一次网络读取
        data = { songs: (songs || []).map((x) => Object.assign({}, x)) };
        sha = indexSha;
      } else {
        const j = await ghApi(ghPath("index.json") + "?ref=" + cfg.branch, "GET", null, true);
        data = j ? JSON.parse(decodeB64(j.content)) : { songs: [] };
        if (j) { sha = j.sha; indexSha = j.sha; }
      }
      mutator(data);
      data.updated = Date.now();
      const body = { message: "update index", content: encodeB64(JSON.stringify(data)), branch: cfg.branch };
      if (sha) body.sha = sha;
      try {
        const resp = await ghApi(ghPath("index.json"), "PUT", body);
        indexSha = (resp && resp.content && resp.content.sha) || null;
        songs = (data.songs || []).slice().sort((a, b) => b.up - a.up);
        return;
      } catch (e) {
        if (!/冲突/.test(e.message) || attempt === 5) throw e;
        indexSha = null; // 发生冲突：强制下一次重新读取最新数据后再改
        await new Promise((r) => setTimeout(r, 400 + attempt * 600));
      }
    }
  }
  function updateIndex(mutator) {
    const p = indexBusy.then(() => applyIndex(mutator));
    indexBusy = p.catch(() => {});
    return p;
  }

  function purge() {
    if (IS_LOCAL) return;
    ["index.json", "index.html"].forEach((f) => {
      fetch("https://purge.jsdelivr.net/gh/" + cfg.owner + "/" + cfg.repo + "@" + cfg.branch + "/" + f, { mode: "no-cors" }).catch(() => {});
    });
  }

  /* ---------- 上传 ---------- */
  const drop = $("#drop"), fileInput = $("#fileInput"), fileMeta = $("#fileMeta"), dropText = $("#dropText");
  const titleInput = $("#titleInput"), catSelect = $("#catSelect"), uploadBtn = $("#uploadBtn");
  const progress = $("#progress"), progressFill = $("#progressFill");

  function catName() { return catLabel(catSelect.value); }

  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("has"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("has"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("has");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
  });
  catSelect.addEventListener("change", () => syncUploadLabel());
  function syncUploadLabel() {
    uploadBtn.textContent = "上传到「" + catName() + "」";
  }

  function handleFile(f) {
    const okExt = /\.(mp3|wav|m4a|aac|flac|ogg|opus|mp4|webm|wma)$/i.test(f.name);
    if (!/^audio\//.test(f.type) && !okExt) { toast("请选择音频文件（MP3 / WAV / M4A / FLAC 等）"); return; }
    if (f.size > cfg.maxFileMB * 1048576) { toast("文件超过 " + cfg.maxFileMB + "MB 限制，请压缩后再上传"); return; }
    pickFile = f;
    dropText.textContent = f.name;
    drop.classList.add("has");
    titleInput.value = f.name.replace(/\.[^.]+$/, "");
    fileMeta.hidden = false;
    fileMeta.innerHTML = "<span>大小：<b>" + fmtSize(f.size) + "</b></span><span>时长：<b>读取中…</b></span>";
    uploadBtn.disabled = false;
    syncUploadLabel();
    readDuration(f).then((d) => {
      if (pickFile === f) {
        pickDur = d;
        fileMeta.innerHTML = "<span>大小：<b>" + fmtSize(f.size) + "</b></span><span>时长：<b>" + fmtDur(d) + "</b></span>";
      }
    });
    doUpload(); // 选择文件后自动上传，无需再点按钮
  }

  function readDuration(f) {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(f);
        const a = new Audio();
        const timer = setTimeout(() => { URL.revokeObjectURL(url); resolve(0); }, 5000);
        a.addEventListener("loadedmetadata", () => {
          clearTimeout(timer);
          const d = isFinite(a.duration) ? a.duration : 0;
          URL.revokeObjectURL(url);
          resolve(d);
        });
        a.src = url;
      } catch (e) { resolve(0); }
    });
  }

  const fileToBase64 = (f) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("文件读取失败"));
    r.readAsDataURL(f);
  });

  function setUploading(on, text) {
    uploadBtn.disabled = on || !pickFile;
    uploadBtn.textContent = text;
    progress.hidden = !on;
    progressFill.style.width = "0%";
  }

  async function doUpload() {
    if (!pickFile || uploading) return;
    uploading = true;
    const f = pickFile;
    const title = titleInput.value.trim() || f.name.replace(/\.[^.]+$/, "");
    const cat = catSelect.value;
    const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    const ext = (f.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "mp3";
    const filePath = "music/" + id + "." + ext;
    try {
      setUploading(true, "处理文件中…");
      const b64 = await fileToBase64(f);
      if (IS_LOCAL) {
        const r = await fetch("/local/upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: title, cat, ext, base64: b64, dur: pickDur, size: f.size })
        });
        if (!r.ok) throw new Error("本地上传失败");
      } else {
        setUploading(true, "上传中 0%");
        const up = await ghUpload(ghPath(filePath), {
          message: "upload " + filePath, content: b64, branch: cfg.branch
        }, (p) => {
          setUploading(true, "上传中 " + Math.min(99, Math.round(p * 100)) + "%");
        });
        setUploading(true, "更新曲库…");
        await updateIndex((d) => {
          d.songs = d.songs || [];
          // 幂等：重试时不会重复添加
          if (!d.songs.some((x) => x.id === id)) {
            d.songs.push({
              id, title: title.slice(0, 200), cat, file: filePath, size: f.size,
              dur: Math.round(pickDur || 0), up: Date.now(),
              sha: (up && up.content && up.content.sha) || null // 记录文件校验值，删除时免去一次读取
            });
          }
        });
        purge();
      }
      toast("《" + title + "》上传成功，已发布到「" + catName() + "」");
      resetForm();
      loadIndex();
    } catch (e) {
      toast(e.message || "上传失败");
      setUploading(false, "上传到「" + catName() + "」");
    } finally {
      uploading = false;
    }
  }
  uploadBtn.addEventListener("click", () => doUpload());

  function resetForm() {
    pickFile = null; pickDur = 0;
    fileInput.value = "";
    titleInput.value = "";
    dropText.textContent = "点击选择音频文件（选好栏目后自动上传）";
    drop.classList.remove("has");
    fileMeta.hidden = true;
    setUploading(false, "上传到「" + catName() + "」");
  }

  /* ---------- 改名 ---------- */
  async function renameSong(id) {
    const s = songs.find((x) => x.id === id);
    if (!s) return;
    const t = prompt("修改曲目名称：", s.title);
    if (!t || !t.trim()) return;
    const newTitle = t.trim().slice(0, 200);
    try {
      if (IS_LOCAL) {
        const r = await fetch("/local/rename", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, title: newTitle })
        });
        if (!r.ok) throw new Error("本地改名失败");
      } else {
        await updateIndex((d) => {
          const x = (d.songs || []).find((s2) => s2.id === id);
          if (x) x.title = newTitle;
        });
        purge();
      }
      toast("已改名：《" + newTitle + "》");
      loadIndex();
    } catch (e) {
      toast(e.message || "改名失败");
    }
  }

  /* ---------- 删除 ---------- */
  async function deleteRemoteFile(file, sha) {
    try {
      await ghApi(ghPath(file), "DELETE", { message: "delete " + file, sha, branch: cfg.branch });
    } catch (e) {
      // 404：文件已不存在（此前被删过），视为已删除，继续清理曲库记录
      if (/文件不存在/.test(e.message)) return;
      // 409：校验值过期（文件内容与记录不一致），重新读取最新校验值后重试一次
      if (/冲突/.test(e.message)) {
        const j = await ghApi(ghPath(file) + "?ref=" + cfg.branch, "GET", null, true);
        if (!j) return; // 读不到也视为已删除
        await ghApi(ghPath(file), "DELETE", { message: "delete " + file, sha: j.sha, branch: cfg.branch });
        return;
      }
      throw e;
    }
  }
  async function deleteSong(id, btn) {
    const s = songs.find((x) => x.id === id);
    if (!s) return;
    if (!confirm("确定删除《" + s.title + "》吗？删除后不可恢复。")) return;
    if (btn) { btn.disabled = true; btn.textContent = "删除中…"; }
    try {
      if (IS_LOCAL) {
        const r = await fetch("/local/delete", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id })
        });
        if (!r.ok) throw new Error("本地删除失败");
      } else {
        if (s.sha) {
          // 上传时已记录校验值，直接删除（少一次网络请求）
          await deleteRemoteFile(s.file, s.sha);
        } else {
          const j = await ghApi(ghPath(s.file) + "?ref=" + cfg.branch, "GET", null, true);
          if (j) await deleteRemoteFile(s.file, j.sha);
        }
        await updateIndex((d) => { d.songs = (d.songs || []).filter((x) => x.id !== id); });
        purge();
      }
      if (previewId === id) { preview.pause(); previewId = null; }
      toast("已删除《" + s.title + "》");
    } catch (e) {
      toast(e.message || "删除失败");
    }
    loadIndex();
  }

  /* ---------- 登录 / 令牌 / 设置 ---------- */
  function showMain() {
    $("#gate").hidden = true;
    if (!IS_LOCAL && !pat) {
      $("#patGate").hidden = false;
      return;
    }
    $("#patGate").hidden = true;
    $("#main").hidden = false;
    $("#repoInfo").innerHTML = "仓库：<b>" + esc(cfg.owner) + " / " + esc(cfg.repo) + "</b><br>首页：" +
      (IS_LOCAL ? "本地模式（http://localhost）" : esc(cfg.pagesBase) + " （国内建议用 jsDelivr 链接，见 README）");
    initDashboard();
  }

  function initDashboard() {
    renderTabs();
    syncUploadLabel();
    loadIndex();
  }

  $("#gateBtn").addEventListener("click", async () => {
    const pw = $("#gatePw").value;
    const h = sha256(pw);
    const localHash = localStorage.getItem("pwhash");
    if (h === cfg.adminHash || (localHash && h === localHash)) {
      // 密码正确：每次登录都重新解密令牌并覆盖本机旧值（自动修复已失效的缓存令牌）
      if (cfg.patEnc && !IS_LOCAL) {
        try {
          pat = await decryptPat(pw);
          localStorage.setItem("pat", pat);
        } catch (e) {
          $("#gateErr").textContent = "登录配置异常，请联系管理员更新令牌";
          return;
        }
      }
      authed = true;
      sessionStorage.setItem("admin_ok", "1");
      $("#gateErr").textContent = "";
      showMain();
    } else {
      $("#gateErr").textContent = "密码错误，请重试";
    }
  });
  $("#gatePw").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#gateBtn").click(); });

  $("#patSave").addEventListener("click", () => {
    const v = $("#patInput").value.trim();
    if (!TOKEN_RE.test(v)) { toast("令牌格式不正确，应为 ghp_ 或 github_pat_ 开头"); return; }
    pat = v;
    localStorage.setItem("pat", v);
    $("#patGate").hidden = true;
    $("#main").hidden = false;
    $("#patInput2").value = "";
    $("#repoInfo").innerHTML = "仓库：<b>" + esc(cfg.owner) + " / " + esc(cfg.repo) + "</b>";
    initDashboard();
  });

  $("#setBtn").addEventListener("click", () => {
    $("#settings").hidden = false;
    $("#patGroup").hidden = IS_LOCAL || !!cfg.patEnc;
    $("#repoInfo").innerHTML = "仓库：<b>" + esc(cfg.owner) + " / " + esc(cfg.repo) + "</b><br>首页地址：" + (IS_LOCAL ? "本地模式" : esc(cfg.pagesBase));
  });
  $("#setClose").addEventListener("click", () => { $("#settings").hidden = true; });
  $("#patSave2").addEventListener("click", () => {
    const v = $("#patInput2").value.trim();
    if (!TOKEN_RE.test(v)) { toast("令牌格式不正确，应为 ghp_ 或 github_pat_ 开头"); return; }
    pat = v;
    localStorage.setItem("pat", v);
    $("#patInput2").value = "";
    toast("令牌已保存");
  });
  $("#pwSave").addEventListener("click", async () => {
    const a = $("#newPw1").value, b = $("#newPw2").value;
    if (a.length < 6) { toast("新密码至少 6 位"); return; }
    if (a !== b) { toast("两次输入的密码不一致"); return; }
    const newHash = sha256(a);
    // 加密令牌模式下：用新密码重新加密令牌并同步到云端，换设备也能用新密码登录
    if (cfg.patEnc && !IS_LOCAL && pat) {
      try {
        const enc = await encryptPat(a, pat);
        const j = await ghApi(ghPath("assets/config.js") + "?ref=" + cfg.branch, "GET", null, true);
        if (!j) { toast("云端配置读取失败，密码未修改"); return; }
        let cfgText = decodeB64(j.content);
        cfgText = cfgText.replace(/patEnc:\s*\{[^}]*\}/, "patEnc: " + JSON.stringify(enc));
        cfgText = cfgText.replace(/adminHash:\s*"[^"]*"/, 'adminHash: "' + newHash + '"');
        await ghApi(ghPath("assets/config.js"), "PUT", {
          message: "update admin password", content: encodeB64(cfgText), sha: j.sha, branch: cfg.branch
        });
        purge();
      } catch (e) {
        toast("云端同步失败：" + e.message);
        return;
      }
    }
    localStorage.setItem("pwhash", newHash);
    $("#newPw1").value = ""; $("#newPw2").value = "";
    toast(cfg.patEnc && !IS_LOCAL ? "密码已修改并同步到云端" : "密码已修改（仅本机生效）");
  });
  $("#logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("admin_ok");
    location.reload();
  });

  /* ---------- 栏目切换 ---------- */
  document.querySelectorAll(".atab").forEach((t) =>
    t.addEventListener("click", () => {
      curCat = t.getAttribute("data-cat");
      document.querySelectorAll(".atab").forEach((x) => x.classList.toggle("active", x === t));
      catSelect.value = curCat;
      syncUploadLabel();
      renderList();
    })
  );

  /* ---------- 启动 ---------- */
  document.title = cfg.siteName + " · 后台管理";
  const verTag = $("#verTag");
  if (verTag) verTag.textContent = APP_VER;
  if (authed) showMain();
  else { $("#gate").hidden = false; }
})();
