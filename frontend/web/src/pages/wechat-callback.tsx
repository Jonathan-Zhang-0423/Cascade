import { useEffect, useRef } from "react";

// 浏览器端中转：拿到 code+state 发给后端，后端负责换 token 并建立 session
export default function WechatCallbackPage() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (!code || !state) {
      window.location.replace("/login?wechat_error=missing_params");
      return;
    }

    (async () => {
      try {
        const exchangeRes = await fetch("/api/auth/wechat/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ code, state }),
        });
        if (!exchangeRes.ok) {
          const err = await exchangeRes.json().catch(() => ({}));
          // 绑定模式下的错误跳回个人主页
          if (err.error === "wechat_already_linked") {
            window.location.replace("/app?bind_error=wechat_already_linked");
            return;
          }
          window.location.replace(`/login?wechat_error=${encodeURIComponent(err.error || "exchange_failed")}`);
          return;
        }
        const data = await exchangeRes.json();
        // 绑定模式：返回个人主页
        if (data.bound) {
          window.location.replace("/app?bind_success=wechat");
          return;
        }
        // 登录/注册模式
        window.location.replace(data.inviteCode ? "/app" : "/invite-gate?next=/app");
      } catch (e) {
        console.error("[wechat-callback]", e);
        window.location.replace("/login?wechat_error=network_error");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
      正在完成微信登录…
    </div>
  );
}
