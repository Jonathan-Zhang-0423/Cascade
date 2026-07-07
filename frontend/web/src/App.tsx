import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import DashboardPage from "@/pages/dashboard";
import AuthPage from "@/pages/auth";
import SetPasswordPage from "@/pages/set-password";
import OnboardingPage from "@/pages/onboarding";
import LandingPage from "@/pages/landing";
import AdminPage from "@/pages/admin";
import AdminLoginPage from "@/pages/admin-login";
import AdminTotpSetupPage from "@/pages/admin-totp-setup";
import InviteGatePage from "@/pages/invite-gate";
import GitHubCallbackPage from "@/pages/github-callback";
import WechatCallbackPage from "@/pages/wechat-callback";
import ProfileSettingsPage from "@/pages/profile-settings";
import { lazy, Suspense, useEffect, useState } from "react";
import { useIDEStore } from "@/stores/ide-store";

const ABTestPage = lazy(() => import("@/pages/ab-test"));

// Paths that don't require an authenticated session. Landing is public; login
// and onboarding are pre-auth steps; admin has its own admin-secret gate; the
// invite gate is the redirect target for authed users without a redeemed code.
const UNGUARDED_PATHS = ["/", "/login", "/register", "/auth", "/admin/login", "/admin/setup-totp", "/invite-gate", "/github-callback", "/wechat-callback", "/BuilderSquare", "/onboarding", "/set-password"];

function RemovedFeaturePage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
        <a
          className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-black px-4 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
          href="/app"
        >
          返回主页
        </a>
      </section>
    </main>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/login" component={AuthPage} />
      <Route path="/register" component={AuthPage} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/github-callback" component={GitHubCallbackPage} />
      <Route path="/wechat-callback" component={WechatCallbackPage} />
      <Route path="/set-password" component={SetPasswordPage} />
      <Route path="/onboarding" component={OnboardingPage} />
      <Route path="/invite-gate" component={InviteGatePage} />
      <Route path="/BuilderSquare">
        <RemovedFeaturePage
          title="创作者广场已下线"
          description="创作者广场、应用分享、点赞评论和 fork 流程已经从当前产品面剥离。"
        />
      </Route>
      <Route path="/BuilderSquare/app/:id">
        <RemovedFeaturePage
          title="创作者广场已下线"
          description="公开应用详情页已经停用，当前版本只保留账号和基础工作台能力。"
        />
      </Route>
      <Route path="/admin/login" component={AdminLoginPage} />
      <Route path="/admin/setup-totp" component={AdminTotpSetupPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/app" component={DashboardPage} />
      <Route path="/profile" component={ProfileSettingsPage} />
      <Route path="/project/:id">
        <RemovedFeaturePage
          title="项目构建功能已下线"
          description="旧 IDE、项目构建和 agent loop 已经从当前产品面剥离。"
        />
      </Route>
      {import.meta.env.DEV && (
        <Route path="/ab-test">
          <Suspense fallback={<div className="p-8 text-muted-foreground">Loading…</div>}>
            <ABTestPage />
          </Suspense>
        </Route>
      )}
    </Switch>
  );
}

function App() {
  const setUserId = useIDEStore((s) => s.setUserId);
  const setUsername = useIDEStore((s) => s.setUsername);
  const [authChecked, setAuthChecked] = useState(false);
  const [ipBlocked, setIpBlocked] = useState(false);

  useEffect(() => {
    const path = window.location.pathname;
    // API 路径和外部跳转不走守卫
    if (path.startsWith("/api/")) { setAuthChecked(true); return; }
    const isUnguarded = UNGUARDED_PATHS.some(p => path === p || path.startsWith(p + "/"));
    if (isUnguarded) {
      // Best-effort populate the store if a session exists, but never redirect.
      fetch("/api/auth/me").then((r) => {
        if (r.ok) {
          r.json().then((u) => { setUserId(u.id); setUsername(u.username); });
        }
      }).catch(() => {});
      setAuthChecked(true);
      return;
    }
    fetch("/api/auth/me").then(async (r) => {
      if (r.ok) {
        r.json().then((u) => {
          setUserId(u.id);
          setUsername(u.username);
          setAuthChecked(true);
          if (!u.inviteCode && !u.phoneVerified) {
            window.location.href = `/invite-gate?next=${encodeURIComponent(path)}`;
            return;
          }
        });
      } else if (r.status === 403) {
        const body = await r.json().catch(() => ({}));
        if ((body as any).error?.includes("blocked")) {
          setIpBlocked(true);
          setAuthChecked(true);
        } else {
          window.location.href = "/login";
          setAuthChecked(true);
        }
      } else {
        window.location.href = "/login";
        setAuthChecked(true);
      }
    }).catch(() => {
      window.location.href = "/login";
      setAuthChecked(true);
    });
  }, []);

  if (!authChecked && !UNGUARDED_PATHS.some(p => window.location.pathname === p || window.location.pathname.startsWith(p + "/"))) return null;

  if (ipBlocked) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", background: "#fafafa", color: "#111" }}>
        <div style={{ maxWidth: 420, textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>访问受限</h1>
          <p style={{ fontSize: 14, color: "#666", lineHeight: 1.6, marginBottom: 24 }}>
            您的 IP 地址因频繁请求已被临时封禁（1小时），登录状态仍然保留，解封后刷新页面即可继续使用。
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "10px 24px", background: "#3a6ea8", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer" }}
          >
            刷新重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <AppErrorBoundary>
              <Router />
          </AppErrorBoundary>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
