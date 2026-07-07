/**
 * Builds the Express app in-process for integration tests, mirroring
 * `backend/api/src/infra/index.ts` but WITHOUT:
 *   - binding a port at import time (we listen on :0 only when a test wants a URL)
 *   - PgSession (we use in-memory MemoryStore — no session table dependency)
 *   - Vite / static serving
 *
 * `registerRoutes(httpServer, app)` is the clean seam: it wires every /api route
 * and returns once routes are attached. We expose both an in-process `fetch`-like
 * client (`request`) and a real listening URL (`baseUrl`) for SSE/streaming tests.
 */
import express from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { registerRoutes } from "../../src/api/routes/index";

const MemoryStore = createMemoryStore(session);

export interface TestApp {
  app: express.Express;
  server: Server;
  /** http://127.0.0.1:<port> once listening. */
  baseUrl: string;
  /** Reset in-memory rate-limiter windows (shared across tests in a file). */
  resetRateLimiters: () => void;
  /** Stop listening and release the port. */
  close: () => Promise<void>;
}

/**
 * Create and start a test server on an ephemeral port.
 * Each call is an isolated app instance (fresh in-memory session store), but note
 * the route module's session Maps (buildSessions/managerChatSessions) and the
 * concurrency singletons are MODULE-level and therefore shared across instances —
 * tests that assert on them should reset via resetServerState().
 */
export async function createTestApp(): Promise<TestApp> {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.use(
    session({
      store: new MemoryStore({ checkPeriod: 86_400_000 }),
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax", secure: false },
    }),
  );

  await registerRoutes(server, app);

  // Error handler mirrors production so we can assert on 500 bodies.
  app.use((err: any, _req: any, res: any, next: any) => {
    const status = err.status || err.statusCode || 500;
    if (res.headersSent) return next(err);
    res.status(status).json({ message: err.message || "Internal Server Error" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    app,
    server,
    baseUrl,
    resetRateLimiters: () => {
      try { (app as any)._resetRateLimiters?.(); } catch {}
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
