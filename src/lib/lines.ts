/** One entry per non-empty line, trimmed, de-duplicated (first spelling wins). */
export function uniqueLines(text: string): string[] {
  return [...new Set(text.split("\n").map((x) => x.trim()).filter(Boolean))];
}
