import { NoodleActivationRecord, PricingMode, SkuDefinition } from '../types';
import { getRecordBranch } from './branchHelper';

export type ThermalPaperWidth = '58mm' | '80mm';

export interface ThermalPaperSpec {
  paperWidth: ThermalPaperWidth;
  /** Physical roll width in millimeters */
  rollMm: number;
  /** Safe printable width in millimeters (excludes hardware unprintable margins) */
  printableMm: number;
  /** Total printhead dots across printable line at 203 DPI */
  rasterDotsWidth: number;
  /** Safe horizontal padding in dots on each side for raster output */
  rasterSideMarginDots: number;
  /** Maximum monospace character columns per line */
  maxCols: number;
}

export const THERMAL_PAPER_SPECS: Record<ThermalPaperWidth, ThermalPaperSpec> = {
  '58mm': {
    paperWidth: '58mm',
    rollMm: 58,
    printableMm: 48,
    rasterDotsWidth: 384,
    rasterSideMarginDots: 10,
    maxCols: 32,
  },
  '80mm': {
    paperWidth: '80mm',
    rollMm: 80,
    printableMm: 72,
    rasterDotsWidth: 576,
    rasterSideMarginDots: 14,
    maxCols: 48,
  },
};

export interface FormattedReceiptLine {
  kind:
    | 'title'
    | 'subtitle'
    | 'center'
    | 'divider-double'
    | 'divider-single'
    | 'divider-dotted'
    | 'text'
    | 'text-bold'
    | 'kv'
    | 'kv-bold'
    | 'total-grand';
  text?: string;
  left?: string;
  right?: string;
}

export interface FormattedThermalReceipt {
  spec: ThermalPaperSpec;
  hasBurmeseOrNonAscii: boolean;
  lines: FormattedReceiptLine[];
  plainText: string;
}

/**
 * Detects whether a Myanmar string contains legacy Zawgyi-One encoding sequences
 * rather than standard Myanmar Unicode 5.1+.
 */
export function isLikelyZawgyi(input: string): boolean {
  if (!input) return false;
  // 1. Zawgyi-exclusive codepoints (tall u/uu, Zawgyi subscripts, medial ra variants, kinzi, na/ra/aukmyit)
  if (/[\u1033\u1034\u105A\u1060-\u1097]/.test(input)) {
    return true;
  }
  // 2. Visual-order pre-consonant vowel E (U+1031 appearing before a base consonant)
  if (/(?:^|[^\u1000-\u1021\u103B-\u103E\u1039])\u1031[\u1000-\u1021\u103B]/.test(input)) {
    return true;
  }
  // 3. Zawgyi asat (U+1039) at end of syllable without following subscript consonant
  if (/[\u1000-\u1021]\u1039(?![\u1000-\u1021])/.test(input)) {
    return true;
  }
  return false;
}

const ZAWGYI_SUBSCRIPT_MAP: Record<string, string> = {
  '\u1060': '\u1039\u1000',
  '\u1061': '\u1039\u1001',
  '\u1062': '\u1039\u1002',
  '\u1063': '\u1039\u1003',
  '\u1065': '\u1039\u1005',
  '\u1066': '\u1039\u1006',
  '\u1067': '\u1039\u1006',
  '\u1068': '\u1039\u1007',
  '\u1069': '\u1039\u1008',
  '\u106C': '\u1039\u100B',
  '\u106D': '\u1039\u100C',
  '\u1070': '\u1039\u100F',
  '\u1071': '\u1039\u1010',
  '\u1072': '\u1039\u1010',
  '\u1073': '\u1039\u1011',
  '\u1074': '\u1039\u1011',
  '\u1075': '\u1039\u1012',
  '\u1076': '\u1039\u1013',
  '\u1077': '\u1039\u1014',
  '\u1078': '\u1039\u1015',
  '\u1079': '\u1039\u1016',
  '\u107A': '\u1039\u1017',
  '\u107B': '\u1039\u1018',
  '\u107C': '\u1039\u1019',
  '\u1085': '\u1039\u101C',
};

/**
 * Converts legacy Zawgyi-One text to standard Myanmar Unicode 5.1+ sequences.
 */
function convertZawgyiToUnicode(zawgyi: string): string {
  let s = zawgyi;

  // Standalone Zawgyi letters & ligatures
  s = s
    .replace(/\u106A/g, '\u1009')
    .replace(/\u106B/g, '\u100A')
    .replace(/\u108F/g, '\u1014')
    .replace(/\u1090/g, '\u101B')
    .replace(/\u1086/g, '\u103F')
    .replace(/\u1091/g, '\u100F\u1039\u100D')
    .replace(/\u1092/g, '\u100B\u1039\u100C')
    .replace(/\u1097/g, '\u100B\u1039\u100B')
    .replace(/\u106E/g, '\u100D\u1039\u100D')
    .replace(/\u106F/g, '\u100E\u1039\u100D')
    .replace(/\u105A/g, '\u102B\u103A')
    .replace(/\u1025(?=[\u1039\u102C])/g, '\u1009');

  // Tall u / uu & aukmyit variants
  s = s
    .replace(/\u1033/g, '\u102F')
    .replace(/\u1034/g, '\u1030')
    .replace(/[\u1094\u1095]/g, '\u1037');

  // Swap standard Zawgyi medials & asat FIRST using private-use placeholders
  // before expanding multi-codepoint Zawgyi medial ligatures (107D..108A):
  // In Zawgyi: 1039 = asat, 103A = medial ya, 103B = medial ra, 103C = medial wa, 103D = medial ha
  s = s
    .replace(/\u1039/g, '\uE001') // -> 103A (asat)
    .replace(/\u103A/g, '\uE002') // -> 103B (medial ya)
    .replace(/\u103B/g, '\uE003') // -> 103C (medial ra)
    .replace(/\u103C/g, '\uE004') // -> 103D (medial wa)
    .replace(/\u103D/g, '\uE005'); // -> 103E (medial ha)

  // Expand Zawgyi medial combinations directly to Unicode medials
  s = s
    .replace(/\u1096/g, '\u1039\u1010\u103D')
    .replace(/\u107D/g, '\u103B')
    .replace(/[\u107E-\u1084]/g, '\u103C')
    .replace(/\u1087/g, '\u103E')
    .replace(/\u1088/g, '\u103E\u102F')
    .replace(/\u1089/g, '\u103E\u1030')
    .replace(/\u108A/g, '\u103D\u103E');

  // Map Zawgyi subscript consonants
  s = s.replace(/[\u1060-\u1063\u1065-\u1069\u106C\u106D\u1070-\u107C\u1085]/g, (m) => {
    return ZAWGYI_SUBSCRIPT_MAP[m] || m;
  });

  // Restore swapped medials and asat
  s = s
    .replace(/\uE001/g, '\u103A')
    .replace(/\uE002/g, '\u103B')
    .replace(/\uE003/g, '\u103C')
    .replace(/\uE004/g, '\u103D')
    .replace(/\uE005/g, '\u103E');

  // Zawgyi kinzi variants (placed after consonant in Zawgyi, before consonant in Unicode)
  s = s
    .replace(/([\u1000-\u1021])([\u103B-\u103E]*)\u1064/g, '\u1004\u103A\u1039$1$2')
    .replace(/([\u1000-\u1021])([\u103B-\u103E]*)\u108B/g, '\u1004\u103A\u1039$1$2\u102D')
    .replace(/([\u1000-\u1021])([\u103B-\u103E]*)\u108C/g, '\u1004\u103A\u1039$1$2\u102E')
    .replace(/([\u1000-\u1021])([\u103B-\u103E]*)\u108D/g, '\u1004\u103A\u1039$1$2\u1036');

  // Reorder visual pre-base E vowel (\u1031) and medial ra (\u103C) to logical Unicode order:
  // Zawgyi: [1031]? + [103C]? + Consonant + [Subscript]? + [Medials]?
  s = s.replace(
    /(\u1031)?(\u103C)?([\u1000-\u1021])((?:\u1039[\u1000-\u1021])?)([\u103B-\u103E]*)/g,
    (_match, eVowel = '', preRa = '', cons: string, sub = '', postMedials = '') => {
      const mergedMedials = `${preRa}${postMedials}`;
      return `${cons}${sub}${mergedMedials}${eVowel}`;
    }
  );

  return s;
}

/**
 * Reorders Myanmar Unicode combining marks within each syllable cluster to strict
 * Unicode 5.1+ canonical storage order so thermal/OpenType engines never render dotted circles (◌).
 */
function canonicalizeMyanmarCombiningOrder(text: string): string {
  // Fix common typing inversions in Unicode input:
  // 1. Lower vowel (102F/1030) typed before upper vowel (102D/102E) -> upper then lower
  let out = text.replace(/([\u102F\u1030])([\u102D\u102E])/g, '$2$1');
  // 2. Anusvara (1036) typed after lower vowel -> 102F + 1036 is valid, keep 1037 (dot below) after 1036/102F/103A
  out = out.replace(/\u1037([\u102D-\u1030\u1032\u1036\u103A])/g, '$1\u1037');
  // 3. Deduplicate accidental double identical vowels/medials typed on mobile keyboards
  out = out.replace(/([\u102D-\u1032\u1036\u1037\u1038\u103A-\u103E])\1+/g, '$1');
  return out;
}

/**
 * Normalizes any Burmese & English receipt string into clean UTF-8 NFC Unicode,
 * converting Zawgyi if detected and replacing non-thermal punctuation that causes mojibake.
 */
export function normalizeReceiptText(raw: string | undefined | null): string {
  if (raw == null) return '';
  let text = String(raw);

  // Strip BOM, zero-width non-printing garbage, replacement chars, and control chars
  text = text
    .replace(/[\uFEFF\u200B\u200E\u200F\u202A-\u202E\uFFFD]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Replace smart typography & extended Latin symbols that cause CP437/GBK mojibake (e.g. Â·, â€")
  text = text
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u2018\u2019\u201A\u201B`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00B7\u2022\u2027\u2219\u25AA\u25CF]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00D7/g, 'x');

  // Convert Zawgyi-One to Myanmar Unicode per whitespace-delimited segment
  // so mixed Zawgyi + Unicode inputs normalize cleanly without corrupting valid Unicode words
  if (/[\u1000-\u109F]/.test(text)) {
    text = text
      .split(/(\s+)/)
      .map((segment) =>
        isLikelyZawgyi(segment) ? convertZawgyiToUnicode(segment) : segment
      )
      .join('');
    text = canonicalizeMyanmarCombiningOrder(text);
  }

  try {
    text = text.normalize('NFC');
  } catch {
    // Fallback if environment lacks normalize
  }

  // Verify clean UTF-8 round-trip
  try {
    const utf8 = new TextEncoder().encode(text);
    text = new TextDecoder('utf-8', { fatal: false }).decode(utf8);
  } catch {
    // Keep normalized string
  }

  return text.replace(/\s+/g, ' ').trim();
}

export function containsNonAsciiText(text: string): boolean {
  return /[^\x20-\x7E\r\n]/.test(text);
}

/**
 * Segments mixed Burmese + English text into indivisible Myanmar syllable / grapheme clusters
 * so line wrapping NEVER splits a base consonant from its medials, vowels, subscripts, or coda.
 */
const MYANMAR_SYLLABLE_TOKEN_REGEX =
  /[([{"']*(?:\u1004\u103A\u1039)?[\u1000-\u102A\u103F\u1040-\u104F](?:\u1039[\u1000-\u1021])*[\u102B-\u103E\u1056-\u1059]*(?:[\u1000-\u1021]\u103A[\u1037\u1038]?(?![\u102B-\u1036\u1039\u103B-\u103E]))?[)\]}",.:;!?]*|[\u1000-\u109F]+|\s+|[^\s\u1000-\u109F]+/g;

function segmentIntoWrappableUnits(text: string): string[] {
  if (!text) return [];
  const rawTokens = text.match(MYANMAR_SYLLABLE_TOKEN_REGEX);
  if (!rawTokens) return [text];

  const units: string[] = [];
  for (const token of rawTokens) {
    // Break hyphenated/slashed Latin words cleanly while keeping punctuation attached
    if (/^[^\s\u1000-\u109F]+$/.test(token) && token.length > 1) {
      const subParts = token.match(/[^-/,]+[-/,]?|[-/,]+/g);
      if (subParts && subParts.length > 1) {
        units.push(...subParts);
        continue;
      }
    }
    units.push(token);
  }
  return units;
}

/**
 * Estimates visual thermal column width of a string (accounting for zero-width Burmese
 * above/below combining marks vs spacing vowels/medials and wider Myanmar base glyphs)
 * so wrapped lines strictly fit within printable paper margins.
 */
export function measureVisualColumns(text: string): number {
  if (!text) return 0;
  let cols = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    // Zero-width / non-spacing Myanmar combining marks (upper/lower vowels, asat, dot below, wa/ha)
    if (
      (code >= 0x102d && code <= 0x1030) ||
      code === 0x1032 ||
      code === 0x1036 ||
      code === 0x1037 ||
      code === 0x103a ||
      code === 0x103d ||
      code === 0x103e ||
      (code >= 0x1056 && code <= 0x1059)
    ) {
      continue;
    }

    // Myanmar virama (U+1039) + stacked subscript consonant occupies ~0 extra horizontal width
    if (code === 0x1039) {
      if (i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0x1000 && next <= 0x1021) {
          i += 1; // skip stacked subscript width
        }
      }
      continue;
    }

    // Spacing Myanmar vowels/medials/tones (ါ, ာ, ေ, း, ျ, ြ)
    if (
      code === 0x102b ||
      code === 0x102c ||
      code === 0x1031 ||
      code === 0x1038 ||
      code === 0x103b ||
      code === 0x103c
    ) {
      cols += 0.85;
      continue;
    }

    // Myanmar base consonants, independent vowels, digits, punctuation (U+1000..U+104F)
    if (code >= 0x1000 && code <= 0x109f) {
      cols += 1.3;
      continue;
    }

    // CJK / fullwidth fallback
    if (code >= 0x2e80) {
      cols += 2;
      continue;
    }

    // Standard ASCII / Latin monospace char
    cols += 1;
  }

  return Math.ceil(cols - 0.001);
}

/**
 * Splits an oversized single token (such as a very long unbroken Latin identifier)
 * into chunks that each fit within `maxCols` without breaking Myanmar syllables.
 */
function splitOversizedUnit(unit: string, maxCols: number): string[] {
  if (measureVisualColumns(unit) <= maxCols) return [unit];

  // Segment by grapheme cluster so even fallback splitting never breaks combining marks
  let graphemes: string[];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const Seg = (
      Intl as unknown as {
        Segmenter: new (
          locale: string,
          opts: { granularity: 'grapheme' }
        ) => { segment: (s: string) => Iterable<{ segment: string }> };
      }
    ).Segmenter;
    graphemes = Array.from(new Seg('my', { granularity: 'grapheme' }).segment(unit), (g) => g.segment);
  } else {
    graphemes = Array.from(unit);
  }

  const chunks: string[] = [];
  let current = '';
  for (const g of graphemes) {
    const candidate = current + g;
    if (current && measureVisualColumns(candidate) > maxCols) {
      chunks.push(current);
      current = g;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Automatically wraps arbitrary Burmese/English text to fit strictly within `maxCols`
 * printable character columns, supporting optional continuation indentation.
 */
export function wrapThermalText(
  rawText: string,
  maxCols: number,
  continuationIndent = ''
): string[] {
  const cleaned = normalizeReceiptText(rawText);
  if (!cleaned) return [''];

  const safeMaxCols = Math.max(8, maxCols);
  const indentCols = measureVisualColumns(continuationIndent);
  const effectiveContIndent = indentCols < safeMaxCols - 6 ? continuationIndent : '';

  const units = segmentIntoWrappableUnits(cleaned);
  const lines: string[] = [];
  let currentLine = '';

  const pushCurrentLine = () => {
    if (currentLine.trim().length > 0) {
      lines.push(currentLine.trimEnd());
    }
    currentLine = lines.length > 0 ? effectiveContIndent : '';
  };

  for (const unit of units) {
    if (/^\s+$/.test(unit)) {
      if (
        currentLine &&
        currentLine !== effectiveContIndent &&
        !currentLine.endsWith(' ')
      ) {
        if (measureVisualColumns(currentLine + ' ') < safeMaxCols) {
          currentLine += ' ';
        } else {
          pushCurrentLine();
        }
      }
      continue;
    }

    const activePrefix =
      currentLine === '' && lines.length > 0 ? effectiveContIndent : currentLine;
    const prefixTrimmedEmpty = activePrefix.trim().length === 0;
    const availableForSingleUnit = prefixTrimmedEmpty
      ? safeMaxCols - measureVisualColumns(activePrefix)
      : safeMaxCols;

    if (measureVisualColumns(unit) > availableForSingleUnit) {
      if (!prefixTrimmedEmpty) {
        currentLine = activePrefix;
        pushCurrentLine();
      }
      const chunkBudget =
        safeMaxCols -
        measureVisualColumns(lines.length > 0 ? effectiveContIndent : '');
      const subChunks = splitOversizedUnit(unit, Math.max(6, chunkBudget));
      for (let idx = 0; idx < subChunks.length; idx++) {
        const prefix = lines.length > 0 ? effectiveContIndent : '';
        if (idx < subChunks.length - 1) {
          lines.push((prefix + subChunks[idx]).trimEnd());
        } else {
          currentLine = prefix + subChunks[idx];
        }
      }
      continue;
    }

    const candidate = activePrefix + unit;
    if (measureVisualColumns(candidate) <= safeMaxCols) {
      currentLine = candidate;
    } else {
      currentLine = activePrefix;
      pushCurrentLine();
      currentLine = (lines.length > 0 ? effectiveContIndent : '') + unit;
    }
  }

  if (currentLine.trim().length > 0) {
    lines.push(currentLine.trimEnd());
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * Formats a left/right pair into one or more receipt lines guaranteed not to exceed `maxCols`.
 * If `left` + 1 space + `right` fits on one line, emits a single aligned `kv` line.
 * Otherwise wraps `left` cleanly across full-width lines and right-aligns `right` without clipping.
 */
function buildWrappedKeyValueLines(
  leftRaw: string,
  rightRaw: string,
  maxCols: number,
  bold = false
): FormattedReceiptLine[] {
  const left = normalizeReceiptText(leftRaw);
  const right = normalizeReceiptText(rightRaw);
  const kind = bold ? 'kv-bold' : 'kv';
  const textKind = bold ? 'text-bold' : 'text';

  const leftCols = measureVisualColumns(left);
  const rightCols = measureVisualColumns(right);

  if (leftCols + 1 + rightCols <= maxCols) {
    return [{ kind, left, right }];
  }

  // Try wrapping `left` while keeping last wrapped segment paired with `right` if it fits
  const wrappedLeft = wrapThermalText(left, maxCols, '  ');
  const result: FormattedReceiptLine[] = [];

  if (wrappedLeft.length >= 1) {
    const lastLeft = wrappedLeft[wrappedLeft.length - 1];
    if (
      measureVisualColumns(lastLeft) + 2 + rightCols <= maxCols &&
      rightCols < maxCols
    ) {
      for (let i = 0; i < wrappedLeft.length - 1; i++) {
        result.push({ kind: textKind, text: wrappedLeft[i] });
      }
      result.push({ kind, left: lastLeft, right });
      return result;
    }
  }

  // Otherwise emit wrapped `left` lines, then right-aligned (or wrapped) `right` lines
  for (const l of wrappedLeft) {
    result.push({ kind: textKind, text: l });
  }
  if (rightCols <= maxCols - 2) {
    result.push({ kind, left: '', right });
  } else {
    const wrappedRight = wrapThermalText(right, maxCols - 2, '  ');
    for (const r of wrappedRight) {
      result.push({ kind, left: '', right: r.trim() });
    }
  }
  return result;
}

/**
 * Formats a labeled field (`LABEL: value`) so long values (like Burmese store names or addresses)
 * wrap cleanly across multiple lines within `maxCols` with zero overflow.
 */
function buildLabeledWrappedField(
  label: string,
  valueRaw: string,
  maxCols: number,
  boldValue = false
): FormattedReceiptLine[] {
  const cleanLabel = normalizeReceiptText(label);
  const cleanVal = normalizeReceiptText(valueRaw);
  if (!cleanVal) return [];

  const combined = `${cleanLabel} ${cleanVal}`;
  const wrapped = wrapThermalText(combined, maxCols, '  ');
  return wrapped.map((line) => ({
    kind: boldValue ? 'text-bold' : 'text',
    text: line,
  }));
}

function formatReceiptTimestamp(isoOrDate?: string): string {
  try {
    const d = isoOrDate ? new Date(isoOrDate) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '';
  }
}

function formatPrintedDateTime(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Builds the canonical, width-constrained, NFC-encoded thermal receipt structure
 * shared identically across on-screen preview, native browser print, PNG capture,
 * plain-text copy, and ESC/POS Bluetooth thermal printers.
 */
export function formatThermalReceiptDocument(
  record: NoodleActivationRecord,
  paperWidth: ThermalPaperWidth,
  skus: SkuDefinition[] = []
): FormattedThermalReceipt {
  const spec = THERMAL_PAPER_SPECS[paperWidth];
  const maxCols = spec.maxCols;
  // Title uses slightly larger font, so wrap conservatively at ~82% of maxCols
  const titleCols = paperWidth === '58mm' ? 26 : 38;
  const grandTotalCols = paperWidth === '58mm' ? 26 : 38;

  const lines: FormattedReceiptLine[] = [];

  const pushCenteredWrapped = (
    raw: string,
    kind: 'title' | 'subtitle' | 'center',
    colLimit = maxCols
  ) => {
    const wrapped = wrapThermalText(raw, colLimit);
    for (const l of wrapped) {
      lines.push({ kind, text: l });
    }
  };

  // 1. Company Header
  pushCenteredWrapped('PAHTAMA GROUP CO., LTD.', 'title', titleCols);
  pushCenteredWrapped('Shaloot Noodle Activation & Sales', 'subtitle', maxCols);
  pushCenteredWrapped('OFFICIAL THERMAL POS INVOICE', 'center', maxCols);
  lines.push({ kind: 'divider-double' });

  // 2. Metadata Block
  const branchName = normalizeReceiptText(record.branch || getRecordBranch(record));
  const createdTime = formatReceiptTimestamp(record.createdAt);
  const dateDisplay = createdTime
    ? `${normalizeReceiptText(record.activationDate)} ${createdTime}`
    : normalizeReceiptText(record.activationDate);

  lines.push(...buildWrappedKeyValueLines('INV NO:', record.invoiceNo, maxCols, true));
  lines.push(...buildWrappedKeyValueLines('DATE:', dateDisplay, maxCols, false));
  lines.push(...buildWrappedKeyValueLines('BRANCH:', branchName, maxCols, true));

  const sellerDisplay = record.sellerName
    ? `${record.sellerUsername} (${record.sellerName})`
    : record.sellerUsername;
  lines.push(...buildWrappedKeyValueLines('SELLER:', sellerDisplay, maxCols, false));
  lines.push(...buildWrappedKeyValueLines('ROUTE:', record.routeCode, maxCols, true));
  lines.push(...buildWrappedKeyValueLines('PG COVER:', record.pgCover, maxCols, false));

  lines.push({ kind: 'divider-dotted' });

  lines.push(
    ...buildLabeledWrappedField('WHOLESALE:', record.wholesaleStoreName, maxCols, true)
  );
  lines.push(
    ...buildLabeledWrappedField(
      `RETAILER (${normalizeReceiptText(record.outletType)}):`,
      record.retailerStoreName,
      maxCols,
      true
    )
  );

  if (record.phoneNumber && record.phoneNumber.trim() !== '-') {
    lines.push(...buildWrappedKeyValueLines('PHONE:', record.phoneNumber, maxCols, false));
  }

  if (record.fullAddress) {
    lines.push(...buildLabeledWrappedField('ADDR:', record.fullAddress, maxCols, false));
  }

  lines.push({ kind: 'divider-dotted' });
  lines.push(
    ...buildWrappedKeyValueLines(
      'PRICE MODE:',
      record.pricingMode === PricingMode.COMPANY_LDP
        ? 'COMPANY LTP'
        : 'MANUAL STORE',
      maxCols,
      false
    )
  );
  lines.push({ kind: 'divider-single' });

  // 3. SKU Items or Non-Covered Survey Reason
  const paidItems = record.items.filter((i) => i.quantity > 0);
  const focItems = record.items.filter((i) => i.focQuantity > 0);
  const skuMap = new Map<string, SkuDefinition>();
  for (const s of skus) {
    skuMap.set(s.id, s);
  }

  if (record.salesStatus) {
    lines.push(
      ...buildWrappedKeyValueLines('PAID ITEM / QTY', 'TOTAL (MMK)', maxCols, true)
    );
    lines.push({ kind: 'divider-single' });

    if (paidItems.length > 0) {
      paidItems.forEach((item, idx) => {
        const matchedSku = skuMap.get(item.skuId);
        for (const wLine of wrapThermalText(item.skuName, maxCols, '  ')) {
          lines.push({ kind: 'text-bold', text: wLine });
        }
        if (matchedSku?.myanmarSubName) {
          for (const mmLine of wrapThermalText(matchedSku.myanmarSubName, maxCols, '  ')) {
            lines.push({ kind: 'text', text: mmLine });
          }
        }
        lines.push(
          ...buildWrappedKeyValueLines(
            `  ${item.quantity} x ${item.unitPrice.toLocaleString()} MMK`,
            `${item.lineTotal.toLocaleString()} MMK`,
            maxCols,
            true
          )
        );
        if (idx < paidItems.length - 1) {
          lines.push({ kind: 'divider-dotted' });
        }
      });
    } else {
      for (const l of wrapThermalText('0 paid packs (FOC sampling only).', maxCols)) {
        lines.push({ kind: 'text', text: l });
      }
    }

    lines.push({ kind: 'divider-single' });
    lines.push(
      ...buildWrappedKeyValueLines('FOC SAMPLING (FREE)', '0 MMK', maxCols, true)
    );

    if (focItems.length > 0) {
      focItems.forEach((item) => {
        const shortName = normalizeReceiptText(
          item.skuName.replace(/^Shaloot Noodle\s+/i, '')
        );
        lines.push(
          ...buildWrappedKeyValueLines(
            `FOC: ${shortName}`,
            `${item.focQuantity} pcs (0 MMK)`,
            maxCols,
            false
          )
        );
      });
    } else {
      for (const l of wrapThermalText('No FOC packs issued.', maxCols)) {
        lines.push({ kind: 'text', text: l });
      }
    }
  } else {
    for (const l of wrapThermalText('NON-COVERED SURVEY VISIT', maxCols)) {
      lines.push({ kind: 'text-bold', text: l });
    }
    lines.push(
      ...buildLabeledWrappedField(
        'REASON:',
        record.nonCoveredReason || 'Recorded Visit',
        maxCols,
        false
      )
    );
  }

  // 4. Totals Block
  lines.push({ kind: 'divider-double' });
  lines.push(
    ...buildWrappedKeyValueLines('TOTAL PAID PACKS:', `${record.totalPaidQty} pcs`, maxCols, true)
  );
  lines.push(
    ...buildWrappedKeyValueLines('TOTAL FOC PACKS:', `${record.totalFocQty} pcs`, maxCols, true)
  );
  lines.push({ kind: 'divider-single' });

  const grandTotalRight = `${record.grandTotalMmk.toLocaleString()} MMK`;
  if (
    measureVisualColumns('GRAND TOTAL:') + 1 + measureVisualColumns(grandTotalRight) <=
    grandTotalCols
  ) {
    lines.push({
      kind: 'total-grand',
      left: 'GRAND TOTAL:',
      right: grandTotalRight,
    });
  } else {
    lines.push({ kind: 'text-bold', text: 'GRAND TOTAL:' });
    lines.push({ kind: 'total-grand', left: '', right: grandTotalRight });
  }
  lines.push({ kind: 'divider-double' });

  // 5. Optional Remarks
  if (record.remarks && record.remarks.trim()) {
    lines.push(...buildLabeledWrappedField('REMARKS:', record.remarks, maxCols, false));
    lines.push({ kind: 'divider-single' });
  }

  // 6. Footer
  pushCenteredWrapped('THANK YOU FOR YOUR PARTNERSHIP!', 'subtitle', maxCols);
  pushCenteredWrapped('Pahtama Group Co., Ltd. - Shaloot Noodle', 'center', maxCols);
  pushCenteredWrapped(`Verify: ${record.invoiceNo}`, 'center', maxCols);
  pushCenteredWrapped(`Printed: ${formatPrintedDateTime()}`, 'center', maxCols);

  // Build plain-text representation strictly bounded to `maxCols`
  const plainLines: string[] = [];
  let hasBurmeseOrNonAscii = false;

  for (const entry of lines) {
    if (entry.text && containsNonAsciiText(entry.text)) {
      hasBurmeseOrNonAscii = true;
    }
    if (
      (entry.left && containsNonAsciiText(entry.left)) ||
      (entry.right && containsNonAsciiText(entry.right))
    ) {
      hasBurmeseOrNonAscii = true;
    }

    switch (entry.kind) {
      case 'divider-double':
        plainLines.push('='.repeat(maxCols));
        break;
      case 'divider-single':
        plainLines.push('-'.repeat(maxCols));
        break;
      case 'divider-dotted':
        plainLines.push('.'.repeat(maxCols));
        break;
      case 'title':
      case 'subtitle':
      case 'center': {
        const t = entry.text || '';
        const vis = measureVisualColumns(t);
        const padLeft = Math.max(0, Math.floor((maxCols - vis) / 2));
        plainLines.push(' '.repeat(padLeft) + t);
        break;
      }
      case 'kv':
      case 'kv-bold':
      case 'total-grand': {
        const l = entry.left || '';
        const r = entry.right || '';
        const gap = Math.max(
          1,
          maxCols - measureVisualColumns(l) - measureVisualColumns(r)
        );
        plainLines.push(l + ' '.repeat(gap) + r);
        break;
      }
      default:
        plainLines.push(entry.text || '');
        break;
    }
  }

  return {
    spec,
    hasBurmeseOrNonAscii,
    lines,
    plainText: plainLines.join('\n'),
  };
}

const ESC = 0x1b;
const FS = 0x1c;
const GS = 0x1d;
const LF = 0x0a;

const ESC_POS_CMD = {
  INIT: [ESC, 0x40],
  // Cancel legacy Chinese GBK multibyte mode so UTF-8 3-byte Burmese sequences aren't corrupted into GBK mojibake
  CANCEL_CHINESE_MODE: [FS, 0x2e],
  // Enable UTF-8 character encoding on modern ESC/POS firmware (Epson/Xprinter/Sunmi UTF-8 codepage)
  SELECT_UTF8_MODE: [FS, 0x43, 0xff],
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  DOUBLE_HEIGHT_ON: [GS, 0x21, 0x01],
  NORMAL_SIZE: [GS, 0x21, 0x00],
  FEED_4_LINES: [ESC, 0x64, 0x04],
  CUT_PAPER: [GS, 0x56, 0x41, 0x10],
};

/**
 * Generates UTF-8 NFC encoded ESC/POS text command bytes with strict printable column wrapping.
 */
export function buildEscPosTextReceiptBytes(
  record: NoodleActivationRecord,
  paperWidth: ThermalPaperWidth,
  skus: SkuDefinition[] = []
): Uint8Array {
  const formatted = formatThermalReceiptDocument(record, paperWidth, skus);
  const maxCols = formatted.spec.maxCols;
  const encoder = new TextEncoder();
  const bytes: number[] = [];

  const pushRaw = (arr: number[]) => {
    for (let i = 0; i < arr.length; i++) bytes.push(arr[i]);
  };
  const pushUtf8Line = (text = '') => {
    const encoded = encoder.encode(text);
    for (let i = 0; i < encoded.length; i++) bytes.push(encoded[i]);
    bytes.push(LF);
  };

  pushRaw(ESC_POS_CMD.INIT);
  pushRaw(ESC_POS_CMD.CANCEL_CHINESE_MODE);
  pushRaw(ESC_POS_CMD.SELECT_UTF8_MODE);

  for (const entry of formatted.lines) {
    switch (entry.kind) {
      case 'title':
        pushRaw(ESC_POS_CMD.ALIGN_CENTER);
        pushRaw(ESC_POS_CMD.BOLD_ON);
        pushRaw(ESC_POS_CMD.DOUBLE_HEIGHT_ON);
        pushUtf8Line(entry.text || '');
        pushRaw(ESC_POS_CMD.NORMAL_SIZE);
        pushRaw(ESC_POS_CMD.BOLD_OFF);
        break;
      case 'subtitle':
        pushRaw(ESC_POS_CMD.ALIGN_CENTER);
        pushRaw(ESC_POS_CMD.BOLD_ON);
        pushUtf8Line(entry.text || '');
        pushRaw(ESC_POS_CMD.BOLD_OFF);
        break;
      case 'center':
        pushRaw(ESC_POS_CMD.ALIGN_CENTER);
        pushUtf8Line(entry.text || '');
        break;
      case 'divider-double':
        pushRaw(ESC_POS_CMD.ALIGN_LEFT);
        pushUtf8Line('='.repeat(maxCols));
        break;
      case 'divider-single':
        pushRaw(ESC_POS_CMD.ALIGN_LEFT);
        pushUtf8Line('-'.repeat(maxCols));
        break;
      case 'divider-dotted':
        pushRaw(ESC_POS_CMD.ALIGN_LEFT);
        pushUtf8Line('.'.repeat(maxCols));
        break;
      case 'text-bold':
        pushRaw(ESC_POS_CMD.ALIGN_LEFT);
        pushRaw(ESC_POS_CMD.BOLD_ON);
        pushUtf8Line(entry.text || '');
        pushRaw(ESC_POS_CMD.BOLD_OFF);
        break;
      case 'text':
        pushRaw(ESC_POS_CMD.ALIGN_LEFT);
        pushUtf8Line(entry.text || '');
        break;
      case 'kv':
      case 'kv-bold':
      case 'total-grand': {
        pushRaw(ESC_POS_CMD.ALIGN_LEFT);
        const l = entry.left || '';
        const r = entry.right || '';
        const gap = Math.max(
          1,
          maxCols - measureVisualColumns(l) - measureVisualColumns(r)
        );
        const isBold = entry.kind !== 'kv';
        if (isBold) pushRaw(ESC_POS_CMD.BOLD_ON);
        if (entry.kind === 'total-grand') pushRaw(ESC_POS_CMD.DOUBLE_HEIGHT_ON);
        pushUtf8Line(l + ' '.repeat(gap) + r);
        if (entry.kind === 'total-grand') pushRaw(ESC_POS_CMD.NORMAL_SIZE);
        if (isBold) pushRaw(ESC_POS_CMD.BOLD_OFF);
        break;
      }
    }
  }

  pushRaw(ESC_POS_CMD.FEED_4_LINES);
  pushRaw(ESC_POS_CMD.CUT_PAPER);
  return new Uint8Array(bytes);
}

/**
 * Splits a string by pixel width on an HTML5 Canvas context at Myanmar syllable boundaries
 * as a secondary pixel-level safety guard so zero glyphs ever touch hardware print margins.
 */
function wrapCanvasTextByPixels(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number
): string[] {
  if (!text) return [''];
  if (ctx.measureText(text).width <= maxWidthPx) return [text];

  const units = segmentIntoWrappableUnits(text);
  const rows: string[] = [];
  let current = '';

  for (const u of units) {
    const candidate = current + u;
    if (current.trim().length > 0 && ctx.measureText(candidate).width > maxWidthPx) {
      rows.push(current.trimEnd());
      current = u.trimStart();
    } else {
      current = candidate;
    }
  }
  if (current.trim().length > 0) rows.push(current.trimEnd());
  return rows.length > 0 ? rows : [text];
}

/**
 * Renders the formatted receipt onto an exact 384-dot (58mm) or 576-dot (80mm)
 * monochrome raster bitmap using OpenType Myanmar shaping (`Padauk` / `Noto Sans Myanmar`)
 * and encodes striped ESC/POS `GS v 0` commands.
 *
 * This eliminates Burmese mojibake on 100% of Bluetooth thermal printers, including
 * printers that lack built-in Myanmar Unicode font ROMs.
 */
export async function buildEscPosRasterReceiptBytes(
  record: NoodleActivationRecord,
  paperWidth: ThermalPaperWidth,
  skus: SkuDefinition[] = []
): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    return buildEscPosTextReceiptBytes(record, paperWidth, skus);
  }

  // Wait for Myanmar webfonts (Padauk / Noto Sans Myanmar) to finish loading before shaping
  try {
    if (document.fonts && document.fonts.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ]);
    }
  } catch {
    // Proceed with system fonts if font API unavailable
  }

  const formatted = formatThermalReceiptDocument(record, paperWidth, skus);
  const { rasterDotsWidth, rasterSideMarginDots } = formatted.spec;
  const contentWidthPx = rasterDotsWidth - rasterSideMarginDots * 2;

  const fontStack =
    "'Padauk', 'Noto Sans Myanmar', 'Myanmar Text', 'JetBrains Mono', monospace";
  const baseFontPx = paperWidth === '58mm' ? 20 : 22;
  const titleFontPx = paperWidth === '58mm' ? 24 : 28;
  const grandFontPx = paperWidth === '58mm' ? 23 : 26;
  const lineHeightMultiplier = 1.45; // Generous vertical clearance for Myanmar stacked subscripts & upper vowels

  interface DrawOp {
    y: number;
    height: number;
    draw: (ctx: CanvasRenderingContext2D) => void;
  }

  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = rasterDotsWidth;
  measureCanvas.height = 64;
  const mCtx = measureCanvas.getContext('2d');
  if (!mCtx) {
    return buildEscPosTextReceiptBytes(record, paperWidth, skus);
  }

  const ops: DrawOp[] = [];
  let cursorY = 12;

  for (const entry of formatted.lines) {
    if (
      entry.kind === 'divider-double' ||
      entry.kind === 'divider-single' ||
      entry.kind === 'divider-dotted'
    ) {
      const h = 14;
      const yPos = cursorY;
      ops.push({
        y: yPos,
        height: h,
        draw: (ctx) => {
          ctx.save();
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = entry.kind === 'divider-double' ? 2 : 1;
          if (entry.kind === 'divider-dotted') {
            ctx.setLineDash([3, 3]);
          } else if (entry.kind === 'divider-single') {
            ctx.setLineDash([6, 3]);
          }
          const midY = Math.round(yPos + h / 2) + 0.5;
          ctx.beginPath();
          ctx.moveTo(rasterSideMarginDots, midY);
          ctx.lineTo(rasterDotsWidth - rasterSideMarginDots, midY);
          ctx.stroke();
          if (entry.kind === 'divider-double') {
            ctx.beginPath();
            ctx.moveTo(rasterSideMarginDots, midY + 3);
            ctx.lineTo(rasterDotsWidth - rasterSideMarginDots, midY + 3);
            ctx.stroke();
          }
          ctx.restore();
        },
      });
      cursorY += h;
      continue;
    }

    if (
      entry.kind === 'title' ||
      entry.kind === 'subtitle' ||
      entry.kind === 'center'
    ) {
      const fontSize = entry.kind === 'title' ? titleFontPx : baseFontPx;
      const fontWeight = entry.kind === 'center' ? '600' : '700';
      const fontSpec = `${fontWeight} ${fontSize}px ${fontStack}`;
      mCtx.font = fontSpec;
      const pixelRows = wrapCanvasTextByPixels(
        mCtx,
        entry.text || '',
        contentWidthPx
      );
      const rowH = Math.ceil(fontSize * lineHeightMultiplier);

      for (const rText of pixelRows) {
        const yPos = cursorY;
        ops.push({
          y: yPos,
          height: rowH,
          draw: (ctx) => {
            ctx.font = fontSpec;
            ctx.fillStyle = '#000000';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(rText, rasterDotsWidth / 2, yPos + 2, contentWidthPx);
          },
        });
        cursorY += rowH;
      }
      continue;
    }

    if (
      entry.kind === 'kv' ||
      entry.kind === 'kv-bold' ||
      entry.kind === 'total-grand'
    ) {
      const fontSize = entry.kind === 'total-grand' ? grandFontPx : baseFontPx;
      const fontWeight = entry.kind === 'kv' ? '600' : '700';
      const fontSpec = `${fontWeight} ${fontSize}px ${fontStack}`;
      mCtx.font = fontSpec;
      const rowH = Math.ceil(fontSize * lineHeightMultiplier);
      const leftStr = entry.left || '';
      const rightStr = entry.right || '';
      const leftW = leftStr ? mCtx.measureText(leftStr).width : 0;
      const rightW = rightStr ? mCtx.measureText(rightStr).width : 0;

      if (leftW + rightW + 12 <= contentWidthPx) {
        const yPos = cursorY;
        ops.push({
          y: yPos,
          height: rowH,
          draw: (ctx) => {
            ctx.font = fontSpec;
            ctx.fillStyle = '#000000';
            ctx.textBaseline = 'top';
            if (leftStr) {
              ctx.textAlign = 'left';
              ctx.fillText(leftStr, rasterSideMarginDots, yPos + 2);
            }
            if (rightStr) {
              ctx.textAlign = 'right';
              ctx.fillText(
                rightStr,
                rasterDotsWidth - rasterSideMarginDots,
                yPos + 2
              );
            }
          },
        });
        cursorY += rowH;
      } else {
        // Pixel-safe fallback if combined width exceeds contentWidthPx: wrap left then right-align right
        if (leftStr) {
          const leftRows = wrapCanvasTextByPixels(mCtx, leftStr, contentWidthPx);
          for (const lr of leftRows) {
            const yPos = cursorY;
            ops.push({
              y: yPos,
              height: rowH,
              draw: (ctx) => {
                ctx.font = fontSpec;
                ctx.fillStyle = '#000000';
                ctx.textBaseline = 'top';
                ctx.textAlign = 'left';
                ctx.fillText(lr, rasterSideMarginDots, yPos + 2, contentWidthPx);
              },
            });
            cursorY += rowH;
          }
        }
        if (rightStr) {
          const yPos = cursorY;
          ops.push({
            y: yPos,
            height: rowH,
            draw: (ctx) => {
              ctx.font = fontSpec;
              ctx.fillStyle = '#000000';
              ctx.textBaseline = 'top';
              ctx.textAlign = 'right';
              ctx.fillText(
                rightStr,
                rasterDotsWidth - rasterSideMarginDots,
                yPos + 2,
                contentWidthPx
              );
            },
          });
          cursorY += rowH;
        }
      }
      continue;
    }

    // Standard left-aligned text / text-bold
    const fontWeight = entry.kind === 'text-bold' ? '700' : '600';
    const fontSpec = `${fontWeight} ${baseFontPx}px ${fontStack}`;
    mCtx.font = fontSpec;
    const rowH = Math.ceil(baseFontPx * lineHeightMultiplier);
    const wrappedRows = wrapCanvasTextByPixels(
      mCtx,
      entry.text || '',
      contentWidthPx
    );

    for (const rText of wrappedRows) {
      const yPos = cursorY;
      ops.push({
        y: yPos,
        height: rowH,
        draw: (ctx) => {
          ctx.font = fontSpec;
          ctx.fillStyle = '#000000';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(rText, rasterSideMarginDots, yPos + 2, contentWidthPx);
        },
      });
      cursorY += rowH;
    }
  }

  const totalHeight = Math.max(64, Math.ceil((cursorY + 16) / 8) * 8);
  const canvas = document.createElement('canvas');
  canvas.width = rasterDotsWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return buildEscPosTextReceiptBytes(record, paperWidth, skus);
  }

  // Pure white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rasterDotsWidth, totalHeight);

  for (const op of ops) {
    op.draw(ctx);
  }

  // Convert RGBA pixels into striped 1-bit monochrome ESC/POS `GS v 0` raster commands
  const imgData = ctx.getImageData(0, 0, rasterDotsWidth, totalHeight).data;
  const bytesPerRow = rasterDotsWidth / 8; // 48 bytes for 384 dots (58mm), 72 bytes for 576 dots (80mm)
  const stripeHeight = 64; // Send in 64-dot-high bands to avoid overflowing small BLE printer buffers
  const out: number[] = [];

  const pushRaw = (arr: number[]) => {
    for (let i = 0; i < arr.length; i++) out.push(arr[i]);
  };

  pushRaw(ESC_POS_CMD.INIT);
  pushRaw(ESC_POS_CMD.ALIGN_CENTER);

  for (let startY = 0; startY < totalHeight; startY += stripeHeight) {
    const bandRows = Math.min(stripeHeight, totalHeight - startY);
    const xL = bytesPerRow & 0xff;
    const xH = (bytesPerRow >> 8) & 0xff;
    const yL = bandRows & 0xff;
    const yH = (bandRows >> 8) & 0xff;

    // GS v 0 m xL xH yL yH d1...dk (m = 0 normal 203 DPI raster)
    pushRaw([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]);

    for (let y = startY; y < startY + bandRows; y++) {
      for (let byteX = 0; byteX < bytesPerRow; byteX++) {
        let packedByte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const px = byteX * 8 + bit;
          const rgbaIdx = (y * rasterDotsWidth + px) * 4;
          const r = imgData[rgbaIdx];
          const g = imgData[rgbaIdx + 1];
          const b = imgData[rgbaIdx + 2];
          const alpha = imgData[rgbaIdx + 3];
          const luminance = alpha < 128 ? 255 : 0.299 * r + 0.587 * g + 0.114 * b;
          if (luminance < 175) {
            packedByte |= 1 << (7 - bit);
          }
        }
        out.push(packedByte);
      }
    }
  }

  pushRaw(ESC_POS_CMD.FEED_4_LINES);
  pushRaw(ESC_POS_CMD.CUT_PAPER);
  return new Uint8Array(out);
}
