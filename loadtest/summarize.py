import json, sys
d = json.load(open(sys.argv[1]))["metrics"]; dur = float(sys.argv[2])
print(f"{'endpoint':14} {'req/s':>8} {'p50 ms':>8} {'p95 ms':>8} {'p99 ms':>8} {'errors':>7}")
out = {}
for ep in ["health", "jobs_list", "jobs_filtered", "companies"]:
    t = d[f"http_req_duration{{ep:{ep}}}"]; n = d[f"http_reqs{{ep:{ep}}}"]["count"]; f = d[f"http_req_failed{{ep:{ep}}}"]
    row = dict(rps=round(n / dur), p50=round(t["med"], 1), p95=round(t["p(95)"], 1), p99=round(t["p(99)"], 1), err=round(100 * f.get("value", f.get("rate", 0)), 2))
    out[ep] = row
    print(f"{ep:14} {row['rps']:>8} {row['p50']:>8} {row['p95']:>8} {row['p99']:>8} {row['err']:>6}%")
json.dump(out, open(sys.argv[1].replace(".json", ".table.json"), "w"))
