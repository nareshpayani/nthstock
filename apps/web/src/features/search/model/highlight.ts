/** A run of text, marked when it matches the query. */
export type TextPart = { text: string; match: boolean };

/** Query words as the search index splits them (letters, digits and &), upper-cased. */
export function queryWords(query: string): string[] {
  return query
    .toUpperCase()
    .split(/[^A-Z0-9&]+/)
    .filter((word) => word.length > 0);
}

function merge(parts: TextPart[]): TextPart[] {
  const out: TextPart[] = [];
  for (const part of parts) {
    if (part.text.length === 0) continue;
    const last = out.at(-1);
    if (last && last.match === part.match) last.text += part.text;
    else out.push({ ...part });
  }
  return out;
}

/** Marks the start of a symbol that the whole query (ignoring case and spaces) begins. */
export function highlightSymbol(symbol: string, query: string): TextPart[] {
  const q = query.trim().toUpperCase();
  if (q.length > 0 && symbol.toUpperCase().startsWith(q)) {
    return merge([
      { text: symbol.slice(0, q.length), match: true },
      { text: symbol.slice(q.length), match: false },
    ]);
  }
  return [{ text: symbol, match: false }];
}

/**
 * Marks, in each word of a name, the longest query word that starts it: the matches the search
 * index ranks by ("tata con" marks "Tata" and "Con" in "Tata Consultancy Services Ltd").
 */
export function highlightName(name: string, query: string): TextPart[] {
  const words = queryWords(query).sort((a, b) => b.length - a.length);
  if (words.length === 0) return [{ text: name, match: false }];
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const found of name.matchAll(/[A-Za-z0-9&]+/g)) {
    const start = found.index;
    const word = found[0];
    const hit = words.find((w) => word.toUpperCase().startsWith(w));
    if (!hit) continue;
    parts.push({ text: name.slice(cursor, start), match: false });
    parts.push({ text: word.slice(0, hit.length), match: true });
    cursor = start + hit.length;
  }
  parts.push({ text: name.slice(cursor), match: false });
  return merge(parts);
}
