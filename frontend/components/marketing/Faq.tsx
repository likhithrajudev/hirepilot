import { ChevronDown } from "lucide-react";

const ITEMS: [string, string][] = [
  ["Does HirePilot apply to jobs for me?", "No. It finds and ranks roles, prepares a tailored resume, a cover letter and answers, then opens the employer's own page so you can review and submit. Employers' terms generally forbid automated applications, and a human submitting is also better for you."],
  ["Do I need my own OpenAI key?", "Not on Pilot or above, where AI is included within generous monthly limits. On any plan you can add your own key in Settings, and your AI actions are then not counted against those limits."],
  ["Which companies do you cover?", "More than 250 company career sites, read directly from the public job boards they publish (Greenhouse, Lever, Ashby, Workday, SmartRecruiters) and straight from Amazon's and Microsoft's own career APIs. We do not scrape LinkedIn or Naukri."],
  ["How does the AI avoid breaking my LaTeX?", "It only ever edits the body of your resume. Your preamble, packages and layout are re-attached byte for byte, and every result is compiled and checked for new numbers, new skills and page count. If it cannot produce something valid, you keep your original."],
  ["Is my resume private?", "Yes. Each account is isolated: another user cannot read, change or even detect your resumes, reviews or settings. Your OpenAI key, if you add one, is encrypted at rest and never sent back to the browser."],
  ["Can I cancel, and what happens to my data?", "Cancel any time. You keep your plan until the end of the period you paid for. If you move to a lower plan nothing is deleted; you simply cannot create new items beyond the lower plan's limits."],
];

export default function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24">
      <h2 id="faq-title" className="text-center text-3xl font-semibold tracking-tight">Questions, answered</h2>
      <div className="mx-auto mt-10 max-w-3xl divide-y divide-line border-y border-line">
        {ITEMS.map(([q, a]) => (
          <details key={q} className="group py-1">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-md py-4 text-left text-[15px] font-medium focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] [&::-webkit-details-marker]:hidden">
              {q}<ChevronDown size={18} className="shrink-0 text-subtle transition-transform duration-200 group-open:rotate-180" aria-hidden />
            </summary>
            <p className="pb-5 pr-10 text-sm leading-relaxed text-muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
