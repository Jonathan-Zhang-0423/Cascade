// 测试实例 PM2 配置 —— 与生产 cascadeai (端口5000/cascade_db) 完全隔离。
// 进程名 cascadeai-test、端口 5100、独立测试库 cascade_test_db、独立日志。
// 用 dev 模式跑源码(Vite 中间件),无需预先 build dist/public。
module.exports = {
  apps: [
    {
      name: "cascadeai-test",
      cwd: "/home/ubuntu/CascadeAI-MY",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "backend/api/src/infra/index.ts",
      interpreter: "/home/ubuntu/.nvm/versions/node/v20.20.2/bin/node",
      env: {
        NODE_ENV: "development",
        PORT: "5100",
      },
      min_uptime: "60s",
      max_restarts: 50,
      exp_backoff_restart_delay: 3000,
      kill_timeout: 12_000,
      max_memory_restart: "1G",
      out_file: "/home/ubuntu/.pm2/logs/cascadeai-test-out.log",
      error_file: "/home/ubuntu/.pm2/logs/cascadeai-test-error.log",
    },
  ],
};
