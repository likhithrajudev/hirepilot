import type { Metadata } from "next";
import Faq from "@/components/marketing/Faq";
import PricingSection from "@/components/marketing/PricingSection";

export const metadata: Metadata = {
  title: "Pricing · HirePilot",
  description: "Cadet is free. Pilot and Captain add AI that is included, more templates and higher limits. Fleet is for teams and programs.",
};

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-24 px-5 py-16 sm:py-20">
      <PricingSection comparison headingLevel={1} />
      <Faq />
    </div>
  );
}
