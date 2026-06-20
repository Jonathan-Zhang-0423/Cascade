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
import LandingPage from "@/pages/landing";
import AdminPage from "@/pages/admin";
import InviteGatePage from "@/pages/invite-gate";
import GitHubCallbackPage from "@/pages/github-callback";
import { lazy, Suspense, useEffect, useState } from "react";
import { useIDEStore } from "@/stores/ide-store";

const ABTestPage = lazy(() => import("@/pages/ab-test"));

const UNGUARDED_PATHS = ["/", "/login", "/auth", "/admin", "/invite-gate", "/github-callback"];

function Router() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/login" component={AuthPage} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/github-callback" component={GitHubCallbackPage} />
      <Route path="/set-password" component={SetPasswordPage} />
      <Route path="/invite-gate" component={InviteGatePage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/app" component={DashboardPage} />
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

  useEffect(() => {
    const path = window.location.pathname;
    const isUnguarded = UNGUARDED_PATHS.includes(path);
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
    fetch("/api/auth/me").then((r) => {
      if (r.ok) {
        r.json().then((u) => {
          setUserId(u.id);
          setUsername(u.username);
          setAuthChecked(true);
          if (!u.inviteCode) {
            window.location.href = `/invite-gate?next=${encodeURIComponent(path)}`;
            return;
          }
        });
      } else {
        window.location.href = "/login";
        setAuthChecked(true);
      }
    }).catch(() => {
      window.location.href = "/login";
      setAuthChecked(true);
    });
  }, []);

  if (!authChecked && !UNGUARDED_PATHS.includes(window.location.pathname)) return null;

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
