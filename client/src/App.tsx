import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import IDEPage from "@/pages/ide";
import DashboardPage from "@/pages/dashboard";
import { lazy, Suspense } from "react";
import { AgentStreamProvider } from "@/components/ide/AgentStreamProvider";

const ABTestPage = lazy(() => import("@/pages/ab-test"));

function Router() {
  return (
    <Switch>
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
