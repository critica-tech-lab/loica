// pm2 process config. The app loads `.env` itself at startup (see
// app/lib/paths.server.ts `loadDotEnv`), so this file no longer parses `.env`.
// The values below are explicit production defaults; everything else (WS_URL,
// MAILGUN_*/SMTP_*, OIDC_*, DATA_DIR, …) comes from `.env`. Precedence is the
// standard one: these explicit values win, `.env` fills the rest.

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
      },
      restart_delay: 1000,
      max_restarts: 10,
    },
  ],
};
