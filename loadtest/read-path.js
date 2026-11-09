// Read-path load test. Closed model: N virtual users hammer one endpoint at a time to find the saturation point.
// Usage: k6 run -e BASE=http://localhost:8001 -e VUS=64 -e DUR=12s --summary-export=out.json loadtest/read-path.js
import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.BASE || "http://localhost:8001";
const VUS = Number(__ENV.VUS || 64);
const DUR = __ENV.DUR || "12s";
const durS = parseInt(DUR);

const endpoints = {
  health: "/api/health",
  jobs_list: "/api/jobs?sort=score&limit=200",
  jobs_filtered: "/api/jobs?location=Bengaluru&level=new_grad&sort=recent&limit=50",
  companies: "/api/jobs/companies",
};

export const options = {
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
  scenarios: Object.fromEntries(
    Object.keys(endpoints).map((name, i) => [
      name,
      { executor: "constant-vus", vus: VUS, duration: DUR, startTime: `${i * (durS + 3)}s`, exec: "hit", env: { EP: name }, tags: { ep: name } },
    ]),
  ),
  thresholds: Object.fromEntries(
    Object.keys(endpoints).flatMap((n) => [[`http_req_duration{ep:${n}}`, ["max>=0"]], [`http_reqs{ep:${n}}`, ["count>=0"]], [`http_req_failed{ep:${n}}`, ["rate>=0"]]]),
  ),
};

export function hit() {
  const r = http.get(BASE + endpoints[__ENV.EP], { tags: { ep: __ENV.EP } });
  check(r, { "status 200": (x) => x.status === 200 });
}
