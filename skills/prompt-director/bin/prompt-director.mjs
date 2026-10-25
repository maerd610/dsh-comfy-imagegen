#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { CATEGORIES, checkPrompt } from '../lib/checker.js';

const USAGE = `prompt-director — deterministic checks for image prompts

Usage:
  prompt-director check --file draft.txt [--category poster] [--copy "on-image text"]...
  prompt-director check --text "A vertical poster…" [--json]

Options:
  --file <path>        read the paragraph from a file
  --text <string>      pass the paragraph inline
  --category <name>    ${CATEGORIES.join(' | ')}   (default: illustration)
  --copy <string>      required verbatim string; repeat for each string
  --json               machine-readable result
  -h, --help           this text

Exit codes:
  0 pass (warnings allowed)   1 errors   2 usage

What it checks: output shape, boosters, camera kit, ratio in prose, reference
leakage, negation, hedge density, required copy, length band.
What it cannot check: whether the picture is good.
`;

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        file: { type: 'string' },
        text: { type: 'string' },
        category: { type: 'string' },
        copy: { type: 'string', multiple: true },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    fail(2, `${error.message}\n\n${USAGE}`);
  }

  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const command = positionals[0];
  if (command !== 'check') fail(2, `unknown command "${command ?? ''}"\n\n${USAGE}`);

  const category = values.category ?? 'illustration';
  if (!CATEGORIES.includes(category)) fail(2, `unknown category "${category}" — use ${CATEGORIES.join(', ')}`);

  let text = values.text;
  if (!text && values.file) {
    try {
      text = await readFile(values.file, 'utf8');
    } catch (error) {
      fail(2, `cannot read ${values.file}: ${error.message}`);
    }
  }
  if (!text) fail(2, 'provide --file or --text\n\n' + USAGE);

  const result = checkPrompt({ text, category, copy: values.copy ?? [] });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const lines = [];
    for (const item of result.errors) lines.push(`error   ${item}`);
    for (const item of result.warnings) lines.push(`warning ${item}`);
    lines.push(
      `${result.ok ? 'pass' : 'fail'} — ${result.stats.words} words, ${category}, ` +
        `${result.errors.length} error(s), ${result.warnings.length} warning(s)`,
    );
    process.stdout.write(`${lines.join('\n')}\n`);
  }

  return result.ok ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
