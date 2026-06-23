// PM2 配置：CascadeAI-MVP（cn 生产服务）
// 用 tsx 直接跑源码 + NODE_ENV=production，走 serveStatic(dist/public)。
// 直接跑源码可让 import.meta.dirname / skills/builtin / 各 compiler 资源路径正常解析，
// 规避 esbuild 把 import.meta 打包成空对象导致的生产构建崩溃。
// 端口 5200，与旧 .co 服务（5000）并行，互不影响。
module.exports = {
  apps: [
    {
      name: "cascadeai-cn",
      cwd: "/home/ubuntu/CascadeAI-MVP",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "backend/api/src/infra/index.ts",
      interpreter: "/home/ubuntu/.nvm/versions/node/v20.20.2/bin/node",
      // 给 Node 堆分配 1.8G，避免 build 期间 JS 对象过多导致 OOM 崩溃
      interpreter_args: "--max-old-space-size=1800",
      env: {
        NODE_ENV: "production",
        PORT: "5200",
      },
      min_uptime: "60s",
      max_restarts: 50,
      exp_backoff_restart_delay: 3000,
      kill_timeout: 12_000,
      // 提高到 2G，避免 build 期间内存峰值触发 pm2 强制重启打断任务
      max_memory_restart: "2G",
      out_file: "/home/ubuntu/.pm2/logs/cascadeai-cn-out.log",
      error_file: "/home/ubuntu/.pm2/logs/cascadeai-cn-error.log",
    },
  ],
};
