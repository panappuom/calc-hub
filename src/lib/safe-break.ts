const UNIT_PATTERN = /(\d+(?:[.,]\d+)?)(\s*)(GB|TB|MB|円|％|%)/gi;
const DASH_PATTERN = /\s\u2013\s/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeUnitMatch(num: string, _spaces: string, unit: string): string {
  return `<span class="nobr">${num}&nbsp;${unit}</span>`;
}

function applyUnitAndDashRules(html: string): string {
  return html
    .replace(UNIT_PATTERN, (_, num: string, spaces: string, unit: string) =>
      normalizeUnitMatch(num, spaces, unit)
    )
    .replace(DASH_PATTERN, () => '<wbr>&nbsp;&ndash;&nbsp;');
}

function applySafeBreakCharacters(html: string): string {
  return html.replace(/([・／\u3000])(?!<wbr>)/g, (_, char: string) => `${char}<wbr>`);
}

function isInsideHtmlEntity(text: string, index: number): boolean {
  const lastAmp = text.lastIndexOf('&', index - 1);
  if (lastAmp === -1) {
    return false;
  }
  const nextSemi = text.indexOf(';', lastAmp);
  return nextSemi !== -1 && nextSemi >= index;
}

function shouldInsertWordBreak(
  text: string,
  prevSegment: Intl.SegmentData,
  nextSegment: Intl.SegmentData
): boolean {
  const boundaryIndex = prevSegment.index + prevSegment.segment.length;
  if (boundaryIndex <= 0 || boundaryIndex >= text.length) {
    return false;
  }

  if (isInsideHtmlEntity(text, boundaryIndex)) {
    return false;
  }

  const prevChar = prevSegment.segment.slice(-1);
  const nextChar = nextSegment.segment.slice(0, 1);

  if (!prevChar || !nextChar) {
    return false;
  }

  if (/\s/.test(prevChar) || /\s/.test(nextChar)) {
    return false;
  }

  if (/[、。，．・：；！？!?,.;:）］｝〉》」』\)\]\}>]/.test(prevChar)) {
    return false;
  }

  if (/[（［｛〈《「『\(\[\{<]/.test(nextChar)) {
    return false;
  }

  return true;
}

function insertWordBreaks(text: string, segmenter: Intl.Segmenter): string {
  const segments = Array.from(segmenter.segment(text));
  if (segments.length <= 1) {
    return text;
  }

  let result = '';
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    result += segment.segment;

    if (i === segments.length - 1) {
      continue;
    }

    const nextSegment = segments[i + 1];
    if (shouldInsertWordBreak(text, segment, nextSegment)) {
      result += '<wbr>';
    }
  }

  return result;
}

function applyIntlSegmenter(html: string): string {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter === 'undefined') {
    return html;
  }

  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
  } catch (error) {
    return html;
  }

  const tagPattern = /<[^>]+>/g;
  const stack: Array<{ tag: string; isNobr: boolean }> = [];
  let result = '';
  let lastIndex = 0;

  const appendText = (text: string) => {
    if (!text) {
      return;
    }
    if (stack.some((item) => item.isNobr)) {
      result += text;
      return;
    }
    result += insertWordBreaks(text, segmenter);
  };

  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    const text = html.slice(lastIndex, match.index);
    appendText(text);

    const tag = match[0];
    result += tag;

    if (/^<\//.test(tag)) {
      const tagName = tag.replace(/^<\/(\w+)[^>]*>$/, '$1').toLowerCase();
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tag === tagName) {
          stack.splice(i, 1);
          break;
        }
      }
    } else if (/^<!--/.test(tag)) {
      // Ignore comments
    } else {
      const isSelfClosing = /\/>$/.test(tag) || /^<wbr\b/i.test(tag);
      const tagNameMatch = /^<([a-zA-Z0-9:-]+)/.exec(tag);
      const tagName = tagNameMatch ? tagNameMatch[1].toLowerCase() : '';
      const isNobr = /class\s*=\s*["']?[^"'>]*\bnobr\b/i.test(tag);

      if (!isSelfClosing && tagName) {
        stack.push({ tag: tagName, isNobr: isNobr || tagName === 'nobr' });
      }
    }

    lastIndex = tagPattern.lastIndex;
  }

  appendText(html.slice(lastIndex));

  return result;
}

function applySafeBreaks(html: string): string {
  let result = html;

  result = applyUnitAndDashRules(result);
  result = applySafeBreakCharacters(result);
  result = result.replace(/<wbr>$/g, '');
  result = applyIntlSegmenter(result);

  return result;
}

export function safeBreak(title: string): string {
  if (!title) {
    return '';
  }

  const escaped = escapeHtml(title);
  return applySafeBreaks(escaped);
}
