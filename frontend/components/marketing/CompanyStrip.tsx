const COMPANIES: [string, string][] = [["Stripe", "stripe.com"], ["Amazon", "amazon.com"], ["Microsoft", "microsoft.com"], ["Salesforce", "salesforce.com"], ["Intel", "intel.com"], ["Airbnb", "airbnb.com"],
  ["Databricks", "databricks.com"], ["Coinbase", "coinbase.com"], ["Spotify", "spotify.com"], ["Figma", "figma.com"], ["Cloudflare", "cloudflare.com"], ["Datadog", "datadoghq.com"]];

export default function CompanyStrip() {
  return (
    <section aria-labelledby="companies-title" className="border-y border-line bg-surface2/40">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <h2 id="companies-title" className="text-center text-xs font-semibold uppercase tracking-wider text-subtle">Scanning the career sites of 250+ companies, including</h2>
        <ul className="mt-6 grid grid-cols-3 items-center gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
          {COMPANIES.map(([name, domain]) => (
            <li key={domain} className="flex items-center justify-center gap-2.5 text-sm font-medium text-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`} alt="" width={22} height={22} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="rounded-[5px]" />{name}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-[11px] text-subtle">Logos belong to their owners. HirePilot is not affiliated with or endorsed by these companies.</p>
      </div>
    </section>
  );
}
