/**
 * Worker public IDs are the handle a studio types to invite a creative, so
 * both ends must agree on the format. The web onboarding form used to mint
 * "#CR-XXXXXX" while the server's fallback minted "TM-123456", which meant an
 * invite typed from one never matched the other.
 */
const PREFIX = 'TM-';
const DIGITS = 6;

export function generateWorkerPublicId(): string {
  const min = 10 ** (DIGITS - 1);
  const max = 10 ** DIGITS - 1;
  return `${PREFIX}${Math.floor(min + Math.random() * (max - min + 1))}`;
}

/**
 * Accepts what a human might paste - "tm-847521", "#CR-847521", " 847521 " -
 * and returns the canonical "TM-847521", or null when there is no usable id.
 */
export function normalizeWorkerPublicId(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length !== DIGITS) return null;
  return `${PREFIX}${digits}`;
}
