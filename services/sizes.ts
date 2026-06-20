// =====================================================================
// Shared size helpers.
// The app historically mixed numeric sizes (65,70,75…) and letter sizes
// (S,M,L…). To avoid the "is this a number or a letter?" confusion we treat
// them as the SAME size and always DISPLAY them as a combined "number/letter"
// label (e.g. "65/S") — number on top, letter below.
// =====================================================================

export interface SizePair {
  num: string;     // numeric label, e.g. "65"
  letter: string;  // canonical letter label, e.g. "S"
  aliases: string[]; // other spellings that mean the same size (uppercased)
}

// Index-aligned numeric <-> letter pairs.
export const SIZE_PAIRS: SizePair[] = [
  { num: '65', letter: 'S', aliases: ['S', 'SMALL'] },
  { num: '70', letter: 'M', aliases: ['M', 'MEDIUM'] },
  { num: '75', letter: 'L', aliases: ['L', 'LARGE'] },
  { num: '80', letter: 'XL', aliases: ['XL'] },
  { num: '85', letter: '2XL', aliases: ['2XL', 'XXL'] },
  { num: '90', letter: '3XL', aliases: ['3XL', 'XXXL'] },
];

/** Canonical letter sizes used as PO column keys. */
export const CANONICAL_SIZES: string[] = SIZE_PAIRS.map((p) => p.letter);

const findPair = (size: string): SizePair | undefined => {
  const s = (size || '').trim().toUpperCase();
  if (!s) return undefined;
  const direct = SIZE_PAIRS.find((p) => p.num === s || p.letter === s || p.aliases.includes(s));
  if (direct) return direct;
  // Handle combined labels like "65/S", "S-65", "65 S" by trying each token.
  for (const tok of s.split(/[\/\\\-\s]+/).filter(Boolean)) {
    const p = SIZE_PAIRS.find((q) => q.num === tok || q.letter === tok || q.aliases.includes(tok));
    if (p) return p;
  }
  return undefined;
};

/** Public lookup for the number<->letter pair behind any size token (or undefined). */
export const sizePair = (size: string): SizePair | undefined => findPair(size);

/** Combined display label, e.g. "65/S". Falls back to the raw size if unknown. */
export const combinedSizeLabel = (size: string): string => {
  const p = findPair(size);
  return p ? `${p.num}/${p.letter}` : size;
};

/** Split a size for stacked (number-over-letter) rendering. */
export const sizeLabelParts = (size: string): { top: string; bottom: string } => {
  const p = findPair(size);
  if (p) return { top: p.num, bottom: p.letter };
  return { top: size, bottom: '' };
};

/** Canonical key used to match equivalent sizes across the app (letter form). */
export const normalizeSize = (size: string): string => {
  const p = findPair(size);
  return p ? p.letter : (size || '').trim().toUpperCase();
};

/** True when two size strings refer to the same physical size. */
export const sizesEqual = (a: string, b: string): boolean => normalizeSize(a) === normalizeSize(b);
