import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import IDEPage from "@/pages/ide";
import DashboardPage from "@/pages/dashboard";
import AuthPage from "@/pages/auth";
import SetPasswordPage from "@/pages/set-password";
import OnboardingPage from "@/pages/onboarding";
import LandingPage from "@/pages/landing";
import AdminPage from "@/pages/admin";
import InviteGatePage from "@/pages/invite-gate";
import GitHubCallbackPage from "@/pages/github-callback";
import CreateSquarePage from "@/pages/create-square";
import AppDetailPage from "@/pages/app-detail";
import AigcPage from "@/pages/aigc";
import WechatCallbackPage from "@/pages/wechat-callback";
import ProfileSettingsPage from "@/pages/profile-settings";
import { lazy, Suspense, useEffect, useState } from "react";
import { useIDEStore } from "@/stores/ide-store";

const ABTestPage = lazy(() => import("@/pages/ab-test"));

// Paths that don't require an authenticated session. Landing is public; login
// and onboarding are pre-auth steps; admin has its own admin-secret gate; the
// invite gate is the redirect target for authed users without a redeemed code.
const UNGUARDED_PATHS = ["/", "/login", "/register", "/auth", "/admin", "/invite-gate", "/github-callback", "/wechat-callback", "/CreateSquare", "/onboarding", "/set-password"];

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
      <Route path="/CreateSquare" component={CreateSquarePage} />
      <Route path="/CreateSquare/app/:id" component={AppDetailPage} />
      <Route path="/aigc" component={AigcPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/app" component={DashboardPage} />
      <Route path="/profile" component={ProfileSettingsPage} />
      <Route path="/project/:id" component={IDEPage} />
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
