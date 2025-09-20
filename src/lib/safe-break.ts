function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeUnitMatch(num: string, spaces: string, unit: string): string {
  const preservedSpaces = spaces
    .replace(/ /g, '&nbsp;')
    .replace(/\u3000/g, '　');
  return `<span class="nobr">${num}${preservedSpaces}${unit}</span>`;
}

const SPECIAL_REGEX_CHARS = /[|\\{}()[\]^$+*?.-]/g;

function escapeRegex(value: string): string {
  return value.replace(SPECIAL_REGEX_CHARS, '\\$&');
}

function applySafeBreaks(html: string): string {
  let result = html;

  result = result.replace(/(\d+(?:[\.,]\d+)?)(\s*)([GTM]B)/gi, (_, num, spaces, unit) =>
    normalizeUnitMatch(num, spaces, unit)
  );

  result = result.replace(/(\d+(?:[\.,]\d+)?)(\s*)(円)/g, (_, num, spaces, unit) =>
    normalizeUnitMatch(num, spaces, unit)
  );

  result = result.replace(/\s–\s/g, () => '<wbr>&nbsp;&ndash;&nbsp;');

  result = result.replace(/価格一覧/g, '<span class="nobr">価格一覧</span>');

  result = result
    .replace(/・(?!<wbr>)/g, '・<wbr>')
    .replace(/／(?!<wbr>)/g, '／<wbr>')
    .replace(/　(?!<wbr>)/g, '　<wbr>');

  return result.replace(/<wbr>$/g, '');
}

const COPY_NOBR_PHRASES = [
  '目安（価格）',
  '価格・在庫',
  '最新情報',
  'ポイント相当',
  '公式RSS',
  '公式API',
  'メーカーや公式ストア',
  'ノイズ（求人・PR等）',
  'アフィリエイトリンク',
  '楽天市場',
  'Yahoo!ショッピング'
];

const LABEL_PREFIXES = ['最終更新', '取得日時', '対象ストア'];

function applyCopyPhrases(html: string): string {
  let result = html;

  for (const phrase of COPY_NOBR_PHRASES) {
    const pattern = new RegExp(escapeRegex(phrase), 'g');
    result = result.replace(pattern, `<span class="nobr">${phrase}</span>`);
  }

  result = result.replace(/ \/ (?!<wbr>)/g, ' / <wbr>');

  if (LABEL_PREFIXES.length) {
    const labelPattern = new RegExp(
      `(${LABEL_PREFIXES.map(escapeRegex).join('|')})([：:])(\s*)([^<]+?)((?:。|$))`,
      'g'
    );
    result = result.replace(labelPattern, (_, label, colon, spaces, value, ending) => {
      const preservedSpaces = spaces.replace(/ /g, '&nbsp;');
      const normalizedValue = value.replace(/ /g, '&nbsp;');
      return `<span class="nobr">${label}${colon}${preservedSpaces}${normalizedValue}</span>${ending}`;
    });

    const labelSpacePattern = new RegExp(
      `(${LABEL_PREFIXES.map(escapeRegex).join('|')})(\s+)([^<]+?)((?:。|$))`,
      'g'
    );
    result = result.replace(labelSpacePattern, (_, label, spaces, value, ending) => {
      const preservedSpaces = spaces.replace(/ /g, '&nbsp;');
      const normalizedValue = value.replace(/ /g, '&nbsp;');
      return `<span class="nobr">${label}${preservedSpaces}${normalizedValue}</span>${ending}`;
    });
  }

  return result;
}

export function safeBreak(title: string): string {
  if (!title) {
    return '';
  }

  const escaped = escapeHtml(title);
  return applySafeBreaks(escaped);
}

export function formatCopy(copy: string | null | undefined): string {
  if (!copy) {
    return '';
  }

  const escaped = escapeHtml(copy);
  const withHeadingBreaks = applySafeBreaks(escaped);
  return applyCopyPhrases(withHeadingBreaks);
}

