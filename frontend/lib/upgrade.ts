"use client";

import { useToast } from "@/app/providers";
import { useCheckout } from "./hooks";
import { planById, type Currency, type Interval } from "./plans";

/** Start an upgrade. Real checkout redirects to Stripe; test mode applies the plan on the spot and says so honestly. */
export function useUpgrade() {
  const checkout = useCheckout();
  const toast = useToast();
  const upgrade = async (plan: string, interval: Interval, currency: Currency): Promise<"redirected" | "applied" | "failed"> => {
    try {
      const r = await checkout.mutateAsync({ plan, interval, currency });
      if (r.mode === "stripe" && r.url) {
        window.location.assign(r.url);
        return "redirected";
      }
      toast(`You are now on ${planById(plan).name}. Test mode: no real charge was made.`, "success");
      return "applied";
    } catch (e) {
      toast((e as Error).message, "error");
      return "failed";
    }
  };
  return { upgrade, pending: checkout.isPending };
}
