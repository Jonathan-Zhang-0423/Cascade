// 腾讯云人机验证（天御验证码）前端取票工具。
// 加载 TCaptcha.js → 弹出滑块/无感验证 → 成功后拿到 ticket + randstr，
// 随业务请求发给后端验票。后端未配置时（enabled=false）跳过，直接放行。

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("tcaptcha-script");
    if (existing) { resolve(); return; }
    const s = document.createElement("script");
    s.id = "tcaptcha-script";
    s.src = "https://turing.captcha.qcloud.com/TCaptcha.js";
    s.onload = () => resolve();
    s.onerror = () => { scriptPromise = null; reject(new Error("Failed to load TCaptcha.js")); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

// 缓存后端配置：是否启用 + CaptchaAppId。
let configPromise: Promise<{ enabled: boolean; appId: string }> | null = null;
function getConfig(): Promise<{ enabled: boolean; appId: string }> {
  if (configPromise) return configPromise;
  configPromise = fetch("/api/config/captcha")
    .then((r) => (r.ok ? r.json() : { enabled: false, appId: "" }))
    .catch(() => ({ enabled: false, appId: "" }));
  return configPromise;
}

export type CaptchaResult = { ticket: string; randstr: string };

// 取票。返回 null 表示用户取消/失败（调用方应中止业务并提示）；
// 返回 {} 空票表示后端未启用人机验证（调用方照常请求即可）。
export async function getCaptchaTicket(): Promise<CaptchaResult | null> {
  const cfg = await getConfig();
  if (!cfg.enabled || !cfg.appId) {
    // 后端未启用——返回空票，业务请求照常发送，后端会降级放行。
    return { ticket: "", randstr: "" };
  }
  await loadScript();
  return new Promise((resolve) => {
    try {
      // @ts-expect-error TencentCaptcha 由外部脚本 TCaptcha.js 注入到 window
      const cap = new TencentCaptcha(cfg.appId, (res: any) => {
        // ret=0 验证成功；ret=2 用户主动关闭验证窗口。
        if (res.ret === 0) resolve({ ticket: res.ticket, randstr: res.randstr });
        else resolve(null);
      });
      cap.show();
    } catch (err) {
      console.error("[captcha] init error", err);
      resolve(null);
    }
  });
}
