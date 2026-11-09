/** Server timestamps are UTC; some arrive without a zone suffix. Parse them as UTC either way. */
export const serverDate = (iso: string): Date => new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
export const fmtDate = (iso: string): string => serverDate(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
