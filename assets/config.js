/* ============================================================
 * 网站配置（部署脚本 deploy/deploy.mjs 会自动改写本文件）
 * 部署后如需修改，请重新运行部署脚本，或在 GitHub 仓库中编辑本文件。
 * ============================================================ */
window.SITE_CONFIG = {
  siteName: "悦音",
  siteSub: "背景音乐 · 女声 · 男声 · 客户音乐 —— 在线试听，一键下载",
  owner: "yigeren1234",      // GitHub 用户名（部署时自动替换）
  repo: "music",                       // GitHub 仓库名（部署时自动替换）
  branch: "main",
  // 后台管理密码的 SHA-256 十六进制值（后台登录只需密码，无需令牌）
  adminHash: "bd525599498df60268ef656229e3692dc31bb388dc9abe1fde0120a8a9203282",
  // 上传令牌的加密存储（用管理密码加密，登录时自动解密使用）
  patEnc: {"salt":"fD7oSfPIZMdH6L5espkFVg==","iv":"OCacDyzseAha9A3k","data":"511sCaO7Ao74cAIewMy8ENzQgPZDrRGM71mIEO/kCHvvCyczLJMqL4mGpcHmhYGgbI8Q13TLwpI="},
  contact: "如需下载「客户音乐」，请联系管理员获取",
  maxFileMB: 19,                       // 免费 CDN 单文件上限，建议 MP3 格式
  // 客户音乐“专属链接”模式：不在首页列表展示，后台可为每首生成专属链接供分享
  // 改为 false 可恢复“客户音乐在首页列表展示”
  hideCustomerFromList: true,
  cats: [
    { key: "customer", label: "客户音乐", cls: "c-customer" },
    { key: "bgm",      label: "客户配音二", cls: "c-bgm" },
    { key: "bgm1",     label: "背景音乐1", cls: "c-bgm" },
    { key: "female",   label: "女声",     cls: "c-female" },
    { key: "male",     label: "男声",     cls: "c-male" }
  ]
};

SITE_CONFIG.isLocal = SITE_CONFIG.owner === "YOUR_GITHUB_USERNAME";
SITE_CONFIG.cdnBase = SITE_CONFIG.isLocal
  ? ""
  : "https://cdn.jsdelivr.net/gh/" + SITE_CONFIG.owner + "/" + SITE_CONFIG.repo + "@" + SITE_CONFIG.branch + "/";
SITE_CONFIG.pagesBase = SITE_CONFIG.isLocal
  ? ""
  : "https://" + SITE_CONFIG.owner + ".github.io/" + SITE_CONFIG.repo + "/";
SITE_CONFIG.apiBase = "https://api.github.com";
