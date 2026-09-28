#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Parser, isMessageQuad } from '../index';
import { quadToString } from '../serialize';

function printUsage(): void {
  process.stderr.write(`Usage: rdf-parser-ts [--format FORMAT] [--base IRI] [--relax] [file]\n\nParses RDF and writes canonical N-Quads/N-Triples-style lines to stdout.\nWhen no file is passed, input is read from stdin.\n\nOptions:\n  --format, -f FORMAT  Input format (e.g. text/turtle, application/n-quads)\n  --base, -b IRI       Base IRI for relative references\n  --relax, -r          Enable relaxed parsing (skips some validation)\n  --silent, -s         Suppress output (useful for benchmarking)\n  --help, -h           Show this help message\n`);
}

const args = process.argv.slice(2);
let format: string | undefined;
let baseIRI: string | undefined;
let silent = false;
let relax = false;
let file: string | undefined;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    printUsage();
    process.exit(0);
  }
  if (arg === '--format' || arg === '-f') {
    format = args[++i];
    continue;
  }
  if (arg === '--relax' || arg === '-r') {
    relax = true;
    continue;
  }
  if (arg === '--silent' || arg === '-s') {
    silent = true;
    continue;
  }
  if (arg === '--base' || arg === '-b') {
    baseIRI = args[++i];
    continue;
  }
  if (arg?.startsWith('--format=')) {
    format = arg.slice('--format='.length);
    continue;
  }
  if (arg?.startsWith('--base=')) {
    baseIRI = arg.slice('--base='.length);
    continue;
  }
  if (!file) {
    file = arg;
    continue;
  }
  throw new Error(`Unexpected argument: ${arg}`);
}

try {
  const input = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
  const parser = new Parser({ format, baseIRI, relax });
  const quads = parser.parse(input) ?? [];
  let i = 0;
  for (const item of quads) {
    if (!silent) {
      const quad = isMessageQuad(item) ? item.quad : item;
      process.stdout.write(`${quadToString(quad)}\n`);
    }
    i++;
  }
  process.stderr.write(`Parsed ${i} quads.\n`);
} catch (error) {
  process.stderr.write(`Error: ${(<Error>error).message}\n`);
  process.exit(1);
}
