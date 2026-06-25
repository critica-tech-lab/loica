// Lightweight liveness probe: returns an instant 200 with no database query,
// disk stat, or shell-out. Intended for uptime monitors, load balancers, and
// platform health checks (e.g. a container orchestrator's HTTP probe) that hit
// it frequently and only need to know the process is up and serving.
//
// The richer /api/health endpoint (disk usage, db size, uptime) is for the
// admin dashboard and is deliberately heavier — don't point probes at it.
export function loader() {
  return new Response("ok", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
