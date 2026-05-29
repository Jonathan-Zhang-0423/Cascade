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
import OnboardingPage from "@/pages/onboarding";
import { lazy, Suspense, useEffect, useState } from "react";
import { AgentStreamProvider } from "@/components/ide/AgentStreamProvider";
import { useIDEStore } from "@/stores/ide-store";

const ABTestPage = lazy(() => import("@/pages/ab-test"));

const UNGUARDED_PATHS = ["/login", "/onboarding"];

function Router() {
  return (
    <Switch>
      <Route path="/login" component={AuthPage} />
      <Route path="/onboarding" component={OnboardingPage} />
      <Route path="/" component={DashboardPage} />
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
    fetch("/api/auth/me").then((r) => {
      if (r.ok) {
        r.json().then((u) => {
          setUserId(u.id);
          setUsername(u.username);
          setAuthChecked(true);
          if (!u.hasSetExperienceLevel && window.location.pathname !== "/onboarding") {
            window.location.href = "/onboarding";
          }
        });
      } else {
        if (window.location.pathname !== "/login") window.location.href = "/login";
        setAuthChecked(true);
      }
    }).catch(() => {
      if (window.location.pathname !== "/login") window.location.href = "/login";
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
            <AgentStreamProvider>
              <Router />
            </AgentStreamProvider>
          </AppErrorBoundary>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
