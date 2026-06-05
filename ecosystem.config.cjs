// PM2 配置：用 tsx 直接跑源码 + NODE_ENV=production
// 走 serveStatic(dist/public)，出开发模式（无 HMR、不暴露源码）。
// 直接跑源码可让 import.meta.dirname / skills/builtin / 各 compiler 资源路径正常解析，
// 规避 esbuild 把 import.meta 打包成空对象导致的生产构建崩溃。
module.exports = {
  apps: [
    {
      name: "cascadeai",
      cwd: "/home/ubuntu/CascadeAI/Cascade",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "backend/api/src/infra/index.ts",
      interpreter: "/home/ubuntu/.nvm/versions/node/v20.20.2/bin/node",
      env: {
        NODE_ENV: "production",
        PORT: "5000",
      },
      // ── 长期连续运行相关 ──────────────────────────────────────
      // min_uptime: 进程稳定运行超过 60s 即视为“正常”，重启计数清零。
      //   这样偶发崩溃不会累计触顶，只有真正的崩溃循环才会触发上限。
      min_uptime: "60s",
      // max_restarts 仅在 min_uptime 内反复崩溃时才计数；配合上面的设置，
      //   长跑期间的零星重启不会耗尽配额。给得宽松一些。
      max_restarts: 50,
      // 崩溃循环时用指数退避，避免疯狂重启打满 CPU（取代固定 restart_delay）。
      exp_backoff_restart_delay: 3000,
      // kill_timeout 必须 > 代码里优雅关闭的 10s 超时，否则 pm2 会在
      //   优雅关闭跑完前就 SIGKILL，前面的 SIGTERM 处理形同虚设。
      kill_timeout: 12_000,
      max_memory_restart: "1G",
      out_file: "/home/ubuntu/.pm2/logs/cascadeai-out.log",
      error_file: "/home/ubuntu/.pm2/logs/cascadeai-error.log",
    },
  ],
};
