import { NoodleActivationRecord } from '../types';
import { YANGON_TOWNSHIPS, MANDALAY_TOWNSHIPS } from '../constants/catalog';

export const BRANCH_OPTIONS = [
  'Yangon',
  'Mandalay',
  'Naypyitaw',
  'Bago',
] as const;

export type BranchName = (typeof BRANCH_OPTIONS)[number];

export const NAYPYITAW_TOWNSHIPS: string[] = [
  'Zabuthiri',
  'Zeyarthiri',
  'Ottarathiri',
  'Dekkhinathiri',
  'Pobbathiri',
  'Pyinmana',
  'Lewe',
  'Tatkon',
];

export const BAGO_TOWNSHIPS: string[] = [
  'Bago',
  'Daik-U',
  'Kawa',
  'Nyaunglebin',
  'Shwegyin',
  'Thanatpin',
  'Waw',
  'Taungoo',
  'Oktwin',
  'Htantabin',
  'Yedashe',
  'Kyaukkyi',
  'Pyay',
  'Paukkhaung',
  'Padaung',
  'Paungde',
  'Thegon',
  'Shwedaung',
  'Thayarwady',
  'Letpadan',
  'Minhla',
  'Monyo',
  'Okpho',
  'Gyobingauk',
  'Zigon',
  'Nattalin',
];

export function getRecordBranch(
  rec?: Partial<NoodleActivationRecord> | null
): BranchName {
  if (!rec) return 'Yangon';

  if (rec.branch) {
    const bLower = rec.branch.trim().toLowerCase();
    if (bLower.includes('yangon') || bLower === 'ygn') return 'Yangon';
    if (bLower.includes('mandalay') || bLower === 'mdy') return 'Mandalay';
    if (
      bLower.includes('naypyitaw') ||
      bLower.includes('nay pyi taw') ||
      bLower === 'npt'
    ) {
      return 'Naypyitaw';
    }
    if (bLower.includes('bago') || bLower === 'bgo') return 'Bago';
  }

  const ts = (rec.township || '').trim().toLowerCase();
  if (ts) {
    if (YANGON_TOWNSHIPS.some((t) => t.toLowerCase() === ts)) return 'Yangon';
    if (MANDALAY_TOWNSHIPS.some((t) => t.toLowerCase() === ts)) return 'Mandalay';
    if (NAYPYITAW_TOWNSHIPS.some((t) => t.toLowerCase() === ts))
      return 'Naypyitaw';
    if (BAGO_TOWNSHIPS.some((t) => t.toLowerCase() === ts)) return 'Bago';
  }

  const haystack = `${rec.regionScope || ''} ${rec.routeCode || ''} ${
    rec.fullAddress || ''
  } ${rec.wholesaleStoreName || ''}`.toLowerCase();

  if (haystack.includes('bgo') || haystack.includes('bago')) {
    if (
      haystack.includes('rt-bgo') ||
      (!haystack.includes('naypyitaw') && !haystack.includes('npt'))
    ) {
      return 'Bago';
    }
  }
  if (
    haystack.includes('naypyitaw') ||
    haystack.includes('nay pyi taw') ||
    haystack.includes('npt')
  ) {
    return 'Naypyitaw';
  }
  if (haystack.includes('mandalay') || haystack.includes('mdy')) {
    return 'Mandalay';
  }
  if (haystack.includes('yangon') || haystack.includes('ygn')) {
    return 'Yangon';
  }

  return 'Yangon';
}
