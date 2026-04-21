import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import IDEPage from "@/pages/ide";
import DashboardPage from "@/pages/dashboard";
import AuthPage from "@/pages/auth";
import { lazy, Suspense, useEffect, useState } from "react";
import { AgentStreamProvider } from "@/components/ide/AgentStreamProvider";
import { useIDEStore } from "@/stores/ide-store";

const ABTestPage = lazy(() => import("@/pages/ab-test"));

function Router() {
  return (
    <Switch>
      <Route path="/login" component={AuthPage} />
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
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => {
      if (r.ok) r.json().then((u) => { setUserId(u.id); setAuthChecked(true); });
      else { if (window.location.pathname !== "/login") window.location.href = "/login"; setAuthChecked(true); }
    }).catch(() => {
      if (window.location.pathname !== "/login") window.location.href = "/login";
      setAuthChecked(true);
    });
  }, []);

  // Render nothing until auth check completes (prevents flash)
  if (!authChecked && window.location.pathname !== "/login") return null;

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <AgentStreamProvider>
            <Router />
          </AgentStreamProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
