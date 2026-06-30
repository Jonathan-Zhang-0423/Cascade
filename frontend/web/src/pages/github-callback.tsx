import { useEffect, useRef } from "react";

// 浏览器端完成 GitHub OAuth token 交换，绕开服务器访问 github.com 被墙的问题。
// 流程：拿到 code+state → 浏览器直接 POST github.com 换 token → 发给后端 /api/auth/github/exchange → 后端建立 session → 跳 /app
export default function GitHubCallbackPage() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (!code || !state) {
      window.location.replace("/login?github_error=missing_params");
      return;
    }

    (async () => {
      try {
        // 通过我们自己的 nginx 代理换 token（直连 github.com 有 CORS 限制）
        const tokenRes = await fetch("/github-oauth/login/oauth/access_token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ code, state }),
        });
        if (!tokenRes.ok) {
          window.location.replace("/login?github_error=token_exchange_failed");
          return;
        }
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
          window.location.replace(`/login?github_error=${encodeURIComponent(tokenData.error || "no_access_token")}`);
          return;
        }

        // 把 access_token 和 state 发给后端，后端验 state、查/建用户、建立 session
        const exchangeRes = await fetch("/api/auth/github/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ accessToken: tokenData.access_token, state }),
        });
        if (!exchangeRes.ok) {
          const err = await exchangeRes.json().catch(() => ({}));
          window.location.replace(`/login?github_error=${encodeURIComponent(err.error || "exchange_failed")}`);
          return;
        }
        const user = await exchangeRes.json();
        window.location.replace(user.inviteCode ? "/app" : "/invite-gate?next=/app");
      } catch {
        window.location.replace("/login?github_error=network_error");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
      正在完成 GitHub 登录…
    </div>
  );
}
