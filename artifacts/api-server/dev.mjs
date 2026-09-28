import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "development" },
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
