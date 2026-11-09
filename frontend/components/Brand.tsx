import { ArrowUpRight } from "lucide-react";

/** Shared brand mark, sized by its surrounding surface. */
export default function Brand({ compact = false, responsive = false }: { compact?: boolean; responsive?: boolean }) {
  return <span className="inline-flex shrink-0 items-center gap-2.5">
    <span aria-hidden="true" className="relative grid h-8 w-8 place-items-center rounded-lg bg-brand text-brand-fg">
      <ArrowUpRight size={23} strokeWidth={2.4} />
      <span className="absolute bottom-[7px] left-[7px] h-1 w-1 rounded-full bg-current" />
    </span>
    {!compact && <span className={`${responsive ? "hidden sm:inline" : ""} text-[17px] font-semibold tracking-[-0.7px]`}>hirepilot<span className="text-brand">.</span></span>}
  </span>;
}
