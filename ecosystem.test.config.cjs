module.exports = {
  apps: [{
    name: "cascadeai-test",
    script: "node_modules/tsx/dist/cli.mjs",
    args: "backend/api/src/infra/index.ts",
    cwd: "/home/ubuntu/CascadeAI-test",
    env: {
      NODE_ENV: "development",
      ...require("dotenv").config({ path: "/home/ubuntu/CascadeAI-test/.env" }).parsed,
    },
    // ── 长期连续运行相关（与生产保持一致，避免崩溃循环/内存泄漏拖垮同机生产进程）──
    min_uptime: "60s",
    max_restarts: 50,
    exp_backoff_restart_delay: 3000,
    kill_timeout: 12_000,
    max_memory_restart: "1G",
  }],
};

