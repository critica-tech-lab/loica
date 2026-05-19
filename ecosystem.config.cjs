const fs = require("fs");
const path = require("path");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return {};
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const dotenv = loadEnvFile();

module.exports = {
  apps: [
    {
      name: "loica-web",
      script: "node_modules/.bin/react-router-serve",
      args: "./build/server/index.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        HOST: "0.0.0.0",
        SECURE_COOKIE: "true",
        ...dotenv,
      },
      restart_delay: 1000,
      max_restarts: 10,
    },
    {
      name: "loica-ws",
      script: "ws-server.ts",
      interpreter: "node",
      interpreter_args: "",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        ...dotenv,
      },
      restart_delay: 1000,
      max_restarts: 10,
    },
  ],
};
