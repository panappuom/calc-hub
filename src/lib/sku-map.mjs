const SKU_ENTRIES = [
  {
    sku: "ssd_1tb",
    keywordVariants: [
      "ssd 1tb",
      "1tb ssd",
      "1 tb ssd",
      "ssd1tb",
      "1テラ ssd",
      "1tera ssd",
      "1000gb ssd",
      "1024gb ssd",
      "ssd 1000gb",
      "ssd 1024gb",
    ],
    tagVariants: [
      "ssd 1tb",
      "ssd_1tb",
      "ssd",
      "1tb",
      "1t",
      "1000gb",
      "1024gb",
    ],
    brandHints: [
      "sandisk",
      "crucial",
      "adata",
      "western digital",
      "wd",
      "samsung",
      "kingston",
    ],
    capacityHints: ["1tb", "1t", "1000gb", "1024gb"],
  },
  {
    sku: "sd_128",
    keywordVariants: [
      "sd 128gb",
      "sdカード 128gb",
      "128gb sd",
      "128 gb sd",
      "sd128gb",
      "microsd 128gb",
      "micro sd 128gb",
      "sdxc 128gb",
      "memory card 128gb",
    ],
    tagVariants: [
      "sd 128gb",
      "sd_128",
      "sdカード",
      "microsd",
      "micro sd",
      "128gb",
    ],
    brandHints: [
      "sandisk",
      "kioxia",
      "transcend",
      "samsung",
      "kingston",
    ],
    capacityHints: ["128gb", "128 g", "128g"],
  },
];

const skuEntryMap = new Map(SKU_ENTRIES.map((entry) => [entry.sku, entry]));

function normalizeText(value = "") {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function createMatchContext({ title = "", summary = "", tags = [], source = "" } = {}) {
  const combinedText = normalizeText([title, summary, source].filter(Boolean).join(" "));
  const normalizedTags = new Set(
    (Array.isArray(tags) ? tags : [])
      .map((tag) => normalizeText(String(tag || "")))
      .filter(Boolean)
  );
  return { combinedText, normalizedTags };
}

function matchesEntry(context, entry) {
  const { combinedText, normalizedTags } = context;

  for (const variant of entry.tagVariants ?? []) {
    if (normalizedTags.has(normalizeText(String(variant)))) {
      return true;
    }
  }

  for (const keyword of entry.keywordVariants ?? []) {
    const normalizedKeyword = normalizeText(String(keyword));
    if (normalizedKeyword && combinedText.includes(normalizedKeyword)) {
      return true;
    }
  }

  const hasBrandHint = (entry.brandHints ?? [])
    .map((hint) => normalizeText(String(hint)))
    .some((hint) => hint && combinedText.includes(hint));
  const hasCapacityHint = (entry.capacityHints ?? [])
    .map((hint) => normalizeText(String(hint)))
    .some((hint) => hint && (combinedText.includes(hint) || normalizedTags.has(hint)));

  return hasBrandHint && hasCapacityHint;
}

export function guessSkuFromDeal(deal) {
  const context = createMatchContext(deal);
  for (const entry of SKU_ENTRIES) {
    if (matchesEntry(context, entry)) {
      return entry.sku;
    }
  }
  return null;
}

export function isDealRelatedToSku(deal, sku) {
  if (!skuEntryMap.has(sku)) {
    return false;
  }
  const entry = skuEntryMap.get(sku);
  const context = createMatchContext(deal);
  return matchesEntry(context, entry);
}

export function getSkuMatchEntry(sku) {
  return skuEntryMap.get(sku) ?? null;
}

export { SKU_ENTRIES };
