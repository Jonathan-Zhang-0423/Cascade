import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// In dev, unregister any service worker left behind by an earlier prod
// build on the same origin. A stray SW intercepts /api/* (NetworkFirst)
// and can serve stale status responses, which broke SSE auto-reconnect
// when switching back to a backgrounded tab.
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((rs) => rs.forEach((r) => r.unregister()))
    .catch(() => {});
}

createRoot(document.getElementById("root")!).render(<App />);
