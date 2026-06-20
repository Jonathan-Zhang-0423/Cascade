import { useEffect, useRef } from "react";

// 浏览器端中转：拿到 code+state 发给后端，后端负责换 token 并建立 session
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
        const exchangeRes = await fetch("/api/auth/github/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ code, state }),
        });
        if (!exchangeRes.ok) {
          const err = await exchangeRes.json().catch(() => ({}));
          window.location.replace(`/login?github_error=${encodeURIComponent(err.error || "exchange_failed")}`);
          return;
        }
        const user = await exchangeRes.json();
        window.location.replace(user.inviteCode ? "/app" : "/invite-gate?next=/app");
      } catch (e) {
        console.error("[github-callback]", e);
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
