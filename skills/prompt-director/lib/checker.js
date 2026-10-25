export const CATEGORIES = ['poster', 'illustration', 'photograph', 'product', 'character'];

const STRUCTURE = {
  heading: /^#{1,6}\s/m,
  fence: /```/,
  json: /^\s*\{[\s\S]*\}\s*$/,
  bullets: /^\s*[-*+]\s/m,
  leadingQuote: /^\s*["“]/,
};

const QUALITY_BOOSTERS = [
  /\b8k\b/i,
  /\b4k\b/i,
  /\bmasterpiece\b/i,
  /\bmasterwork\b/i,
  /\bultra[\s-]?detailed\b/i,
  /\bhighly detailed\b/i,
  /\bhyper[\s-]?realistic\b/i,
  /\baward[\s-]?winning\b/i,
  /\bbest quality\b/i,
  /\bhi[\s-]?res\b/i,
  /\btrending on artstation\b/i,
];

const CAMERA_KIT = [
  /\b\d{2,3}\s?mm\b/i,
  /\bf\/\s?\d(?:\.\d)?\b/i,
  /\bISO\s?\d+\b/i,
  /\bDSLR\b/i,
  /\bmirrorless\b/i,
  /\bshutter speed\b/i,
  /\baperture\b/i,
  /\bbokeh\b/i,
  /\bdepth of field\b/i,
  /\btelephoto\b/i,
  /\bwide[\s-]angle\b/i,
  /\bmacro lens\b/i,
  /\bshot on\b/i,
];

const RATIO_IN_PROSE = [/\b\d{1,2}\s?:\s?\d{1,2}\b/, /\b\d{3,4}\s?[x×]\s?\d{3,4}\b/];
// Image labels are legitimate: current models resolve "picture 1" / "图一".
const REFERENCE_LABEL = /(?:picture|image|photo|ref(?:erence)?)\s*(?:no\.?\s*)?\d|图\s*[一二三四1234]/gi;
// The failure is a pointer with nothing described behind it.
const REFERENCE_VAGUE =
  /\b(same as the (?:reference|uploaded|input)|identical to the (?:reference|photo|input)|as in the (?:picture|image|photo)|the image itself|same face as)\b/i;
const NEGATION = /\b(no|not|never|without|don't|do not|avoid)\b/i;
const HEDGE = /\b(appears to be|appearing to|likely|probably|perhaps|suggesting|may be|might be|seems?)\b/gi;

const LENGTH = {
  poster: [350, 600],
  illustration: [220, 420],
  photograph: [220, 400],
  product: [220, 400],
  character: [260, 460],
};

export function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Deterministic checks only. Nothing here judges taste — it catches the
 * failures that are objectively wrong for an image prompt.
 */
export function checkPrompt({ text, category = 'illustration', copy = [] } = {}) {
  const errors = [];
  const warnings = [];
  const body = typeof text === 'string' ? text : '';

  if (!body.trim()) {
    errors.push('paragraph is empty');
    return { ok: false, errors, warnings, stats: { words: 0, category, copy: copy.length, labels: 0 } };
  }

  if (STRUCTURE.heading.test(body)) errors.push('heading found — return one plain paragraph');
  if (STRUCTURE.fence.test(body)) errors.push('code fence found — return plain text');
  if (STRUCTURE.json.test(body)) errors.push('JSON found — the prompt must be prose, not a schema');
  if (STRUCTURE.bullets.test(body)) warnings.push('bullet list found — prose reads better for image models');
  if (STRUCTURE.leadingQuote.test(body)) warnings.push('paragraph opens with a quote — unquote the whole paragraph');

  for (const re of QUALITY_BOOSTERS) {
    const hit = body.match(re);
    if (hit) errors.push(`quality booster "${hit[0]}" — it buys a stock look, not detail`);
  }

  for (const re of RATIO_IN_PROSE) {
    const hit = body.match(re);
    if (hit) errors.push(`ratio/pixel dimension "${hit[0]}" belongs in the metadata line, not the paragraph`);
  }

  if (category !== 'photograph') {
    for (const re of CAMERA_KIT) {
      const hit = body.match(re);
      if (hit) warnings.push(`camera kit "${hit[0]}" — only legitimate in a photograph brief`);
    }
  }

  if (REFERENCE_VAGUE.test(body)) {
    warnings.push(
      'vague reference pointer — pair it with traits: "the woman from picture 1, narrow face, …"; a label alone asks for a picture of a picture',
    );
  }
  const labels = (body.match(REFERENCE_LABEL) ?? []).length;

  if (NEGATION.test(body)) {
    warnings.push('negation inside the prompt — renderers often draw the named object; use the negative channel');
  }

  const hedges = body.match(HEDGE) ?? [];
  if (hedges.length > 2) warnings.push(`${hedges.length} hedges — keep at most two, where the brief is genuinely open`);

  for (const phrase of copy) {
    if (!phrase) continue;
    if (!body.includes(phrase)) errors.push(`required copy "${phrase}" missing verbatim`);
  }

  const bounds = LENGTH[category] ?? LENGTH.illustration;
  const words = wordCount(body);
  if (words < bounds[0]) warnings.push(`${words} words for ${category} — thin coverage, add positions and light, not adjectives`);
  if (words > bounds[1]) warnings.push(`${words} words for ${category} — cut every sentence that would not change the render`);

  return { ok: errors.length === 0, errors, warnings, stats: { words, category, copy: copy.length, labels } };
}
