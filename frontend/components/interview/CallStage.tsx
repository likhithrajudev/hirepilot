import type { ReactNode } from "react";

/** The open conversation stage is shared by the live room and layout preview. */
export function CallStage({ conversation, camera }: { conversation: ReactNode; camera: ReactNode }) {
  return <main aria-label="Interview call stage" className="absolute inset-x-6 top-[48%] z-10 mx-auto grid max-w-[1220px] -translate-y-1/2 items-center gap-7 md:inset-x-[8vw] md:top-[52%] md:grid-cols-2 md:gap-12">
    <section aria-label="Current conversation" className="order-2 min-w-0 md:order-1">{conversation}</section>
    <div className="order-1 mx-auto aspect-[16/10] w-full max-w-[620px] md:order-2">{camera}</div>
  </main>;
}
