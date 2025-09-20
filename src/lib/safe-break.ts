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

function applySafeBreaks(html: string): string {
  let result = html;

  result = result.replace(/(\d+(?:[\.,]\d+)?)(\s*)([GTM]B)/gi, (_, num, spaces, unit) =>
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

export function safeBreak(title: string): string {
  if (!title) {
    return '';
  }

  const escaped = escapeHtml(title);
  return applySafeBreaks(escaped);
}

