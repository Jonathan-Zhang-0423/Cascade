import type { Page, Route } from "@playwright/test";

/**
 * Browser-layer API mock. Intercepts every `/api/*` request the SPA makes so
 * E2E runs deterministically, offline, and without a real auth session or AI
 * provider. The real Express server still serves the SPA bundle; only the API
 * surface is faked here.
 *
 * State (projects / files / messages) lives in-memory per page so flows like
 * create → open → save → reload behave coherently within a test.
 */

export interface MockProject {
  id: string;
  name: string;
  emoji?: string | null;
  framework?: string;
  language?: string;
  targetPlatform?: string | null;
  createdAt?: string;
}

export interface MockUser {
  id: string;
  username: string;
  inviteCode: string | null;
  hasSetExperienceLevel: boolean;
  experienceLevel?: string;
  trialExpiresAt?: string | null;
}

export interface MockOptions {
  /** Authenticated user returned by /api/auth/me. null → 401 (logged out). */
  user?: MockUser | null;
  /** Seed projects. */
  projects?: MockProject[];
  /**
   * Scripted manager-chat plan-mode stream. Tokens are emitted as
   * `manager_token`/`communicator_token` frames; a plan_ready + manager_done
   * terminate it. perTokenDelayMs paces them so streaming is observable.
   */
  manager?: {
    thinking?: string;
    narration?: string;
    planSteps?: Array<{ step: number; title: string; description: string }>;
    perTokenDelayMs?: number;
  };
}

const DEFAULT_USER: MockUser = {
  id: "e2e-user-1",
  username: "e2e_tester",
  inviteCode: "E2E-INVITE",
  hasSetExperienceLevel: true,
  experienceLevel: "intermediate",
  trialExpiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
};

function sseFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** Build a complete plan-mode SSE body as a single string. */
function buildManagerStream(opts: NonNullable<MockOptions["manager"]>, sessionId: string): string {
  let eventId = 0;
  const frames: string[] = [];
  const push = (o: Record<string, unknown>) => frames.push(sseFrame({ ...o, eventId: eventId++ }));

  push({ type: "session_id", sessionId });
  for (const ch of (opts.thinking ?? "Thinking about it").match(/.{1,4}/g) ?? []) {
    push({ type: "thinking_token", token: ch });
  }
  push({ type: "communicator_narration_starting" });
  for (const ch of (opts.narration ?? "Here is the plan for your app.").match(/.{1,4}/g) ?? []) {
    push({ type: "communicator_token", token: ch });
  }
  const steps = opts.planSteps ?? [
    { step: 1, title: "Scaffold UI", description: "Create the calculator layout" },
    { step: 2, title: "Wire logic", description: "Implement arithmetic handlers" },
  ];
  push({
    type: "plan_ready",
    plan: { summary: "A plan", steps, mode: "manager" },
  });
  push({ type: "manager_done" });
  return frames.join("");
}

export async function installApiMock(page: Page, options: MockOptions = {}): Promise<void> {  const user = options.user === undefined ? DEFAULT_USER : options.user;
  const projects = new Map<string, MockProject>();
  for (const p of options.projects ?? []) projects.set(p.id, { framework: "web", language: "html", ...p });
  const filesByProject = new Map<string, Array<{ path: string; content: string }>>();
  const messagesByProject = new Map<string, any[]>();

  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  // Register on the browser CONTEXT, not the page: context-level routes apply
  // consistently across full-document reloads/navigations, which avoids the
  // race where a page-level interception is torn down mid-navigation and the
  // real server answers /api/auth/me with 401 → App.tsx bounces to /login.
  await page.context().route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    // ── auth ────────────────────────────────────────────────────────────────
    if (path === "/api/auth/me") {
      return user ? json(route, 200, user) : json(route, 401, { error: "Not authenticated" });
    }
    if (path === "/api/auth/logout") return route.fulfill({ status: 204, body: "" });

    // ── projects ──────────────────────────────────────────────────────────────
    if (path === "/api/projects" && method === "GET") {
      return json(route, 200, { projects: [...projects.values()] });
    }
    if (path === "/api/projects" && method === "POST") {
      const body = req.postDataJSON?.() ?? {};
      const proj: MockProject = {
        id: body.id ?? `proj-${Math.random().toString(36).slice(2, 8)}`,
        name: body.name ?? "Untitled",
        emoji: body.emoji ?? null,
        framework: body.framework ?? "web",
        language: body.language ?? "html",
        targetPlatform: body.targetPlatform ?? "both",
        createdAt: new Date().toISOString(),
      };
      projects.set(proj.id, proj);
      return json(route, 200, { project: proj });
    }
    const projMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projMatch && method === "PATCH") {
      const p = projects.get(projMatch[1]);
      if (p) p.name = (req.postDataJSON?.() ?? {}).name ?? p.name;
      return json(route, 200, { ok: true });
    }
    if (projMatch && method === "DELETE") {
      projects.delete(projMatch[1]);
      return json(route, 200, { ok: true });
    }

    // ── files ──────────────────────────────────────────────────────────────
    const filesMatch = path.match(/^\/api\/projects\/([^/]+)\/files$/);
    if (filesMatch && method === "GET") {
      return json(route, 200, { files: filesByProject.get(filesMatch[1]) ?? [] });
    }
    if (filesMatch && method === "PUT") {
      const body = req.postDataJSON?.() ?? {};
      filesByProject.set(filesMatch[1], body.files ?? []);
      return json(route, 200, { ok: true });
    }
    const singleFileMatch = path.match(/^\/api\/projects\/([^/]+)\/files\/single$/);
    if (singleFileMatch && method === "PUT") {
      const body = req.postDataJSON?.() ?? {};
      const arr = filesByProject.get(singleFileMatch[1]) ?? [];
      const i = arr.findIndex((f) => f.path === body.path);
      if (i >= 0) arr[i].content = body.content;
      else arr.push({ path: body.path, content: body.content });
      filesByProject.set(singleFileMatch[1], arr);
      return json(route, 200, { ok: true });
    }

    // ── messages ──────────────────────────────────────────────────────────────
    const msgMatch = path.match(/^\/api\/projects\/([^/]+)\/messages$/);
    if (msgMatch && method === "GET") {
      return json(route, 200, { messages: messagesByProject.get(msgMatch[1]) ?? [] });
    }
    if (msgMatch && method === "POST") {
      const body = req.postDataJSON?.() ?? {};
      messagesByProject.set(msgMatch[1], body.messages ?? []);
      return json(route, 200, { count: (body.messages ?? []).length });
    }

    // ── manager-chat (plan mode) SSE ────────────────────────────────────────────
    if (path === "/api/manager-chat" && method === "POST") {
      const sessionId = `mgr_e2e_${Math.random().toString(36).slice(2, 8)}`;
      const body = buildManagerStream(options.manager ?? {}, sessionId);
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        },
        body,
      });
    }
    if (path.match(/^\/api\/manager-chat\/active\//)) {
      return json(route, 404, { error: "No active session" });
    }
    if (path.match(/^\/api\/manager-chat\/[^/]+\/(status|stream)/)) {
      // Reconnect attempts: report done so the client settles.
      if (path.endsWith("/status")) return json(route, 200, { active: false, done: true, eventCount: 0 });
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "data: [DONE]\n\n" });
    }

    // ── misc fire-and-forget endpoints ──────────────────────────────────────────
    if (path === "/api/generate-project-name") return json(route, 200, { name: "Mock Project" });
    if (path.startsWith("/api/build-session/active/")) return json(route, 404, { error: "none" });

    // Default: empty success so unmocked calls never break a flow.
    return json(route, 200, {});
  });
}

/**
 * Navigate into a project's IDE the way a real user does: load the dashboard
 * first (so the zustand project store hydrates from the mocked /api/projects),
 * then go to the project route. Directly visiting /project/:id with an empty
 * store redirects home, so tests must seed via the dashboard.
 */
export async function openProjectViaDashboard(page: import("@playwright/test").Page, projectId: string): Promise<void> {
  await gotoDashboard(page);
  // Click the project card for client-side (wouter) navigation into the IDE.
  // This avoids a second full page.goto, which would abort the in-flight
  // /api/auth/me and trip App.tsx's catch() → /login redirect race.
  await page.getByTestId(`card-project-${projectId}`).click();
  await page.waitForURL(`**/project/${projectId}`, { timeout: 15_000 });
}

/**
 * Navigate to the dashboard and wait until it is fully interactive. App.tsx
 * gates render on /api/auth/me; if a later navigation starts before that fetch
 * resolves, its catch() bounces to /login. Waiting for the dashboard's own
 * controls (and network idle) before returning removes that race.
 */
export async function gotoDashboard(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/app", { waitUntil: "domcontentloaded" });
  await page
    .getByTestId("button-new-project")
    .or(page.getByTestId("button-new-project-empty"))
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

/**
 * Return to the dashboard from inside the IDE using the in-app back button.
 * This is client-side (wouter) navigation — App.tsx does NOT remount, so it
 * never re-runs the /api/auth/me gate. A hard page.goto("/app") here would
 * race that fetch (the mock fulfillment aborts, the server 401s) and bounce to
 * /login, so always prefer this for IDE → dashboard transitions.
 */
export async function backToDashboard(page: import("@playwright/test").Page): Promise<void> {
  // The IDE has no standalone back button — client-side navigation to the
  // dashboard is via the logo menu → Home (handleBack: saveProject + /app).
  await page.getByTestId("button-logo-menu").click();
  await page.getByTestId("menu-item-home").click();
  await page.waitForURL("**/app", { timeout: 15_000 });
  await page
    .getByTestId("button-new-project")
    .or(page.getByTestId("button-new-project-empty"))
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
}

