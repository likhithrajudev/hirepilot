/** A pause cannot submit an answer when the candidate chose manual turn control. */
export const COMPLETION_CHECK_TIMEOUT_MS = 900;
export const END_OF_ANSWER = /\b(?:that['’]s all|that is all|that['’]s my answer|i['’]m done|i am done|i have finished|i['’]m finished|that concludes my answer|that['’]s it|that['’]s everything)(?: for now)?[.!?\s]*$/i;
const SHORT_REPLY = /^(?:yes|no|i (?:don't|do not) know|i(?:'m| am) not sure|please repeat(?: (?:that|the question))?)[.!?\s]*$/i;
export function hasConfidentTranscript(text: string, final: boolean, voicedMs: number): boolean {
  return final && ((voicedMs >= 150 && SHORT_REPLY.test(text.trim())) || (voicedMs >= 250 && text.trim().split(/\s+/).length >= 3));
}
export function maySubmitAfterSilence(input: { automatic: boolean; silentMs: number; requiredMs: number; now: number; deferUntil: number; checking: boolean; checkingMs?: number }): boolean {
  const waitingForCheck = input.checking && (input.checkingMs ?? 0) < COMPLETION_CHECK_TIMEOUT_MS;
  return input.automatic && !waitingForCheck && input.silentMs >= input.requiredMs && input.now >= input.deferUntil;
}
