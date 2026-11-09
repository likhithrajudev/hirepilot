/** The speech endpoint accepts 500 characters. Keep every request below that bound without losing words. */
export function splitSpeech(text: string): string[] {
  const chunks: string[] = [];
  let rest = text.trim().replace(/\s+/g, " ");
  while (rest.length > 480) {
    const boundary = rest.lastIndexOf(" ", 480);
    const cut = boundary > 0 ? boundary : 480;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
