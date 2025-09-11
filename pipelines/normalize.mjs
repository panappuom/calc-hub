export const ACCESSORY_RE = /(\u30a2\u30c0\u30d7\u30bf|\u30a2\u30c0\u30d7\u30bf\u30fc|adapter|\u5909\u63db|\u30b1\u30fc\u30b9|case|\u30ab\u30d0\u30fc|cover|\u30d2\u30fc\u30c8\u30b7\u30f3\u30af|heatsink|\u30b9\u30c6\u30c3\u30ab\u30fc|sticker|\u5ef6\u9577|\u30b1\u30fc\u30d6\u30eb|cable|\u30ea\u30fc\u30c0\u30fc|reader|\u30d5\u30a3\u30eb\u30e0|film)/i;

export function normalizeTitle(title = '') {
  const tokens = title
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u3000]/g, ' ')
    .replace(/[^a-z0-9-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const important = tokens.filter(t =>
    /^\d+(?:gb|tb|g|t)$/.test(t) ||
    /^uhs-[i]{1,3}$/.test(t) ||
    /^class\d+$/.test(t) ||
    /^u\d$/.test(t) ||
    /^v\d+$/.test(t) ||
    /[a-z]+\d+[a-z0-9-]*/.test(t) ||
    /\d+[a-z][a-z0-9-]*/.test(t)
  );

  important.sort();
  return important.join(' ');
}
