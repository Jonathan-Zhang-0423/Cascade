import { useRef, useMemo, useEffect, useState, useCallback } from "react";
import { useIDEStore, findFileContent, flattenFiles } from "@/stores/ide-store";
import { useProjectStore } from "@/stores/project-store";
import { getPreviewMode, getMainEntryFile } from "@/lib/preview-adapters";
import { RnWebPreview } from "@/components/ide/rn-web-preview";
import { WasmPreview } from "@/components/ide/wasm-preview";
import { FlutterWebPreview } from "@/components/ide/flutter-web-preview";
import { WeChatPreview } from "@/components/ide/wechat-preview";
import { CodePreview } from "@/components/ide/code-preview";

// ─── Preview helpers (from main) ──────────────────────────────────────────────

function resolveFilePath(src: string, basePath: string): string {
  if (src.startsWith("/project/")) return src;
  let resolved: string;
  if (src.startsWith("/")) {
    resolved = `/project${src}`;
  } else {
    const baseDir = basePath.substring(0, basePath.lastIndexOf("/"));
    resolved = `${baseDir}/${src}`;
  }
  const parts = resolved.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === "" && normalized.length > 0) continue;
    if (part === ".") continue;
    if (part === ".." && normalized.length > 1) normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function isExternalUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//");
}

function inlineExternalFiles(html: string, files: ReturnType<typeof flattenFiles>, entryPath = "/project/index.html"): string {
  let result = html;
  result = result.replace(
    /<link\s+([^>]*?)(?:rel=["']stylesheet["'][^>]*?href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*?rel=["']stylesheet["'])[^>]*\/?>/gi,
    (match, _attrs, href1, href2) => {
      const href = href1 || href2;
      if (!href || isExternalUrl(href)) return match;
      const filePath = resolveFilePath(href, entryPath);
      const content = findFileContent(files as Parameters<typeof findFileContent>[0], filePath);
      if (content !== undefined) return `<style>/* ${href} */\n${content}\n</style>`;
      return match;
    }
  );
  result = result.replace(
    /<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (match, src) => {
      if (isExternalUrl(src)) return match;
      const filePath = resolveFilePath(src, entryPath);
      const content = findFileContent(files as Parameters<typeof findFileContent>[0], filePath);
      if (content !== undefined) return `<script>/* ${src} */\n${content}\n</script>`;
      return match;
    }
  );
  return result;
}

// ─── Video FAB types ──────────────────────────────────────────────────────────

type Duration = 10 | 20 | 30;
type RecordState =
  | "idle" | "selecting" | "generating"
  | "done" | "sending" | "sent"
  | "bind_email"
  | "error";

interface VideoJob {
  jobId: string;
  duration: Duration;
  progress: number;
  errorMsg: string;
}

// ─── Bind-email hook ──────────────────────────────────────────────────────────

function useBindEmail(onBound: () => void) {
  const [email, setEmail]         = useState("");
  const [code, setCode]           = useState("");
  const [codeSent, setCodeSent]   = useState(false);
  const [sending, setSending]     = useState(false);
  const [err, setErr]             = useState("");
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCountdown = (sec: number) => {
    setCountdown(sec);
    timerRef.current = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) { clearInterval(timerRef.current!); return 0; }
        return n - 1;
      });
    }, 1000);
  };

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const sendCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr("邮箱格式不正确"); return; }
    setSending(true); setErr("");
    try {
      const res  = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "email", target: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(res.status === 429 ? `发送频繁，请 ${data.retryAfterSec ?? 60}s 后重试` : "发送失败"); return; }
      setCodeSent(true);
      startCountdown(60);
    } catch { setErr("发送失败"); }
    finally { setSending(false); }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) { setErr("验证码为 6 位数字"); return; }
    setSending(true); setErr("");
    try {
      const res  = await fetch("/api/auth/bind-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: email.trim(), code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg: Record<string, string> = {
          "Invalid or expired code":        "验证码无效或已过期",
          "Code locked - request a new one": "验证码已锁定，请重新发送",
          "Email already in use":           "该邮箱已被其他账号使用",
        };
        setErr(msg[data.error] ?? "绑定失败"); return;
      }
      onBound();
    } catch { setErr("绑定失败"); }
    finally { setSending(false); }
  };

  const reset = () => {
    setEmail(""); setCode(""); setCodeSent(false);
    setSending(false); setErr(""); setCountdown(0);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  return { email, setEmail, code, setCode, codeSent, sending, err, countdown, sendCode, verify, reset };
}

// ─── Video recorder hook ──────────────────────────────────────────────────────

function useVideoRecorder() {
  const projectId = useIDEStore((s) => s.projectId);
  const [state, setState] = useState<RecordState>("idle");
  const [job, setJob]     = useState<VideoJob | null>(null);
  const pollTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingJobRef = useRef<string | null>(null);

  const clearPoll = () => {
    if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
  };

  const resetToIdle = useCallback((delayMs = 0) => {
    setTimeout(() => { clearPoll(); setState("idle"); setJob(null); pendingJobRef.current = null; }, delayMs);
  }, []);

  const poll = useCallback((jobId: string) => {
    const tick = async () => {
      try {
        const res  = await fetch(`/api/video/status/${jobId}`);
        if (!res.ok) { resetToIdle(2000); return; }
        const data = await res.json();
        if (data.status === "done") {
          setJob((j) => j ? { ...j, progress: 100 } : j);
          setState("done"); return;
        }
        if (data.status === "error") {
          setJob((j) => j ? { ...j, errorMsg: data.error === "too_many_jobs" ? "队列已满" : "生成失败" } : j);
          setState("error"); resetToIdle(2000); return;
        }
        if (data.progress != null) setJob((j) => j ? { ...j, progress: data.progress } : j);
        pollTimer.current = setTimeout(tick, 2000);
      } catch {
        setJob((j) => j ? { ...j, errorMsg: "生成失败" } : j);
        setState("error"); resetToIdle(2000);
      }
    };
    pollTimer.current = setTimeout(tick, 2000);
  }, [resetToIdle]);

  const start = useCallback(async (duration: Duration) => {
    if (!projectId) return;
    setState("generating");
    setJob({ jobId: "", duration, progress: 0, errorMsg: "" });
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, duration }),
      });
      if (res.status === 429) { setJob((j) => j ? { ...j, errorMsg: "队列已满" } : j); setState("error"); resetToIdle(2000); return; }
      if (!res.ok)            { setJob((j) => j ? { ...j, errorMsg: "生成失败" } : j); setState("error"); resetToIdle(2000); return; }
      const { jobId } = await res.json();
      setJob((j) => j ? { ...j, jobId } : j);
      poll(jobId);
    } catch {
      setJob((j) => j ? { ...j, errorMsg: "生成失败" } : j);
      setState("error"); resetToIdle(2000);
    }
  }, [projectId, poll, resetToIdle]);

  const download = useCallback(() => {
    if (job?.jobId) { window.open(`/api/video/download/${job.jobId}`, "_blank"); resetToIdle(1000); }
  }, [job, resetToIdle]);

  const sendEmail = useCallback(async (jobId?: string) => {
    const id = jobId ?? job?.jobId;
    if (!id) return;
    setState("sending");
    try {
      const res  = await fetch(`/api/video/send-email/${id}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "no_email") { pendingJobRef.current = id; setState("bind_email"); return; }
        setJob((j) => j ? { ...j, errorMsg: "发送失败" } : j);
        setState("error"); resetToIdle(2000); return;
      }
      setState("sent"); resetToIdle(3000);
    } catch {
      setJob((j) => j ? { ...j, errorMsg: "发送失败" } : j);
      setState("error"); resetToIdle(2000);
    }
  }, [job, resetToIdle]);

  const onEmailBound = useCallback(() => {
    const pending = pendingJobRef.current;
    pendingJobRef.current = null;
    if (pending) sendEmail(pending); else resetToIdle();
  }, [sendEmail, resetToIdle]);

  useEffect(() => () => clearPoll(), []);

  return {
    state, job, start, download, sendEmail, onEmailBound,
    setSelecting: () => setState("selecting"),
    setIdle: () => { clearPoll(); setState("idle"); setJob(null); pendingJobRef.current = null; },
  };
}

// ─── VideoFab UI ──────────────────────────────────────────────────────────────

function VideoFab() {
  const { state, job, start, download, sendEmail, onEmailBound, setSelecting, setIdle } = useVideoRecorder();
  const bindEmail = useBindEmail(onEmailBound);
  const panelRef  = useRef<HTMLDivElement>(null);

  useEffect(() => { if (state !== "bind_email") bindEmail.reset(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state !== "selecting" && state !== "done") return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setIdle();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [state, setIdle]);

  const btnBase  = "w-8 h-8 rounded-full flex items-center justify-center shadow-lg transition-colors duration-200 focus:outline-none";
  const btnColor =
    state === "done" || state === "sending" || state === "bind_email" ? "bg-green-500/90" :
    state === "sent"  ? "bg-green-600/90" :
    state === "error" ? "bg-red-500/90"   : "bg-black/60";
  const isBusy = state === "generating" || state === "sending";

  return (
    <div
      ref={panelRef}
      style={{ position: "fixed", bottom: 80, right: 16, zIndex: 60 }}
      className="flex flex-col items-end gap-2"
    >
      {state === "selecting" && (
        <div className="flex flex-col gap-1 bg-black/70 rounded-xl px-2 py-2 shadow-xl">
          {([10, 20, 30] as Duration[]).map((d) => (
            <button key={d} onClick={() => start(d)}
              className="text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-white/20 transition-colors">
              {d}s
            </button>
          ))}
        </div>
      )}

      {state === "done" && (
        <div className="flex flex-col gap-1 bg-black/75 rounded-xl px-2 py-2 shadow-xl min-w-[108px]">
          <button onClick={download} className="flex items-center gap-2 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-white/20 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            直接下载
          </button>
          <button onClick={() => sendEmail()} className="flex items-center gap-2 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-white/20 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
            </svg>
            发到邮箱
          </button>
        </div>
      )}

      {state === "sending" && (
        <div className="bg-black/75 rounded-xl px-3 py-2 shadow-xl">
          <span className="text-white text-xs">发送中…</span>
        </div>
      )}

      {state === "sent" && (
        <div className="bg-green-600/85 rounded-xl px-3 py-2 shadow-xl">
          <span className="text-white text-xs">已发送到邮箱 ✓</span>
        </div>
      )}

      {state === "bind_email" && (
        <div className="flex flex-col gap-2 bg-black/80 rounded-2xl px-3 py-3 shadow-xl w-[220px]">
          <p className="text-white text-xs font-medium leading-snug">
            账号未绑定邮箱<br />
            <span className="text-white/60 font-normal">绑定后视频将自动发送</span>
          </p>
          <div className="flex gap-1">
            <input type="email" placeholder="输入邮箱地址" value={bindEmail.email}
              onChange={(e) => bindEmail.setEmail(e.target.value)}
              className="flex-1 min-w-0 bg-white/10 text-white placeholder-white/40 text-xs rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-white/30" />
            <button onClick={bindEmail.sendCode} disabled={bindEmail.sending || bindEmail.countdown > 0}
              className="shrink-0 text-white/80 text-[10px] px-2 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-40 transition-colors whitespace-nowrap">
              {bindEmail.countdown > 0 ? `${bindEmail.countdown}s` : "发验证码"}
            </button>
          </div>
          {bindEmail.codeSent && (
            <div className="flex gap-1">
              <input type="text" inputMode="numeric" maxLength={6} placeholder="6 位验证码" value={bindEmail.code}
                onChange={(e) => bindEmail.setCode(e.target.value.replace(/\D/g, ""))}
                className="flex-1 min-w-0 bg-white/10 text-white placeholder-white/40 text-xs rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-white/30" />
              <button onClick={bindEmail.verify} disabled={bindEmail.sending}
                className="shrink-0 text-white text-[10px] px-2 py-1.5 rounded-lg bg-green-500/80 hover:bg-green-500 disabled:opacity-40 transition-colors">
                确认绑定
              </button>
            </div>
          )}
          {bindEmail.err && <p className="text-red-400 text-[10px] leading-snug">{bindEmail.err}</p>}
          <button onClick={setIdle} className="text-white/40 text-[10px] text-right hover:text-white/70 transition-colors">取消</button>
        </div>
      )}

      <button onClick={() => { if (state === "idle") setSelecting(); else if (state === "selecting") setIdle(); }}
        disabled={isBusy}
        className={`${btnBase} ${btnColor} ${isBusy ? "cursor-not-allowed" : "cursor-pointer"}`}>
        {state === "generating" && (
          <span className="relative flex items-center justify-center w-full h-full">
            <svg className="animate-spin absolute w-7 h-7 text-white/40" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" />
              <path d="M12 2 a10 10 0 0 1 10 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="text-white text-[9px] font-bold leading-none">{job?.progress ?? 0}%</span>
          </span>
        )}
        {state === "sending" && (
          <svg className="animate-spin w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.3" />
            <path d="M12 2 a10 10 0 0 1 10 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        )}
        {(state === "done" || state === "sent" || state === "bind_email") && (
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {state === "error" && (
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        )}
        {(state === "idle" || state === "selecting") && (
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        )}
      </button>

      {state === "error" && job?.errorMsg && (
        <span className="text-[10px] text-white bg-red-500/80 rounded px-2 py-0.5 whitespace-nowrap">
          {job.errorMsg}
        </span>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MobilePreviewPanel() {
  const {
    files, previewFile, previewRefreshKey,
    previewOverrideHtml, projectFramework, projectId, addConsoleEntry,
  } = useIDEStore();
  const { projects } = useProjectStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const currentProject = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId]
  );
  const framework  = projectFramework || currentProject?.framework || "web";
  const previewMode = getPreviewMode(framework);

  const htmlContent = useMemo(
    () => findFileContent(files, previewFile) || "",
    [files, previewFile, previewRefreshKey]
  );

  const injectedHtml = useMemo(() => {
    const consoleInterceptor = `<script>
(function() {
  const orig = {};
  ['log','warn','error','info'].forEach(function(l) {
    orig[l] = console[l];
    console[l] = function() {
      var msg = Array.prototype.slice.call(arguments).map(function(a) {
        if (typeof a === 'object') { try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); } }
        return String(a);
      }).join(' ');
      window.parent.postMessage({ type: '__cascade_console__', level: l, message: msg }, '*');
      orig[l].apply(console, arguments);
    };
  });
  window.onerror = function(msg, _s, line) {
    window.parent.postMessage({ type: '__cascade_console__', level: 'error', message: msg + (line ? ' (line ' + line + ')' : '') }, '*');
  };
})();
</script>`;
    const flat     = flattenFiles(files);
    const resolved = inlineExternalFiles(htmlContent, flat, previewFile);
    if (resolved.includes('<head>')) return resolved.replace('<head>', '<head>' + consoleInterceptor);
    return consoleInterceptor + resolved;
  }, [htmlContent, files, previewFile]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (
        e.data?.type === "__cascade_console__" &&
        iframeRef.current &&
        e.source === iframeRef.current.contentWindow
      ) {
        const level   = e.data.level as string;
        const message = String(e.data.message || "");
        if (["log", "warn", "error", "info"].includes(level)) {
          addConsoleEntry({ level: level as "log" | "warn" | "error" | "info", message });
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [addConsoleEntry]);

  const isEmpty = !previewOverrideHtml && !previewFile && previewMode === "iframe-preview";

  return (
    <div className="w-full h-full overflow-hidden relative bg-black">
      {previewMode === "kotlin-wasm" || previewMode === "swift-wasm" ? (
        <WasmPreview files={files} framework={framework} projectId={projectId} refreshKey={previewRefreshKey} />
      ) : previewMode === "code-preview" ? (
        <CodePreview files={files} framework={framework} projectId={projectId} mainEntryFile={getMainEntryFile(framework)} />
      ) : previewMode === "rn-web" ? (
        <RnWebPreview files={files} framework={framework} projectId={projectId} refreshKey={previewRefreshKey} projectName={currentProject?.name} />
      ) : previewMode === "flutter-web" ? (
        <FlutterWebPreview files={files} framework={framework} projectId={projectId} refreshKey={previewRefreshKey} />
      ) : previewMode === "wechat-preview" ? (
        <WeChatPreview files={files} refreshKey={previewRefreshKey} projectId={projectId} />
      ) : isEmpty ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-slate-500">
            <rect x="4" y="4" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 10l7 4-7 4V10z" fill="currentColor" />
          </svg>
          <p className="text-[12px] text-slate-500">Run the app to see a preview</p>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          key={previewRefreshKey}
          srcDoc={previewOverrideHtml ?? injectedHtml}
          className="w-full h-full border-0"
          title="Preview"
          sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups"
          data-testid="preview-iframe"
        />
      )}
      <VideoFab />
    </div>
  );
}
