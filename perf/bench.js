#!/usr/bin/env node
'use strict';

const { Readable } = require('node:stream');
const { StreamParser } = require('../dist');
const { StreamParser: N3StreamParser } = require('n3');
let graphyNQuadsRead = null;
try {
  graphyNQuadsRead = require('@graphy/content.nq.read');
} catch {
  // Optional benchmark dependency.
}

const DEFAULT_SIZES = [10_000, 100_000];
const CHUNK_SIZE = 64 * 1024;

function parseArgs(argv) {
  const args = { sizes: DEFAULT_SIZES, includeN3: true, includeGraphy: true, includeTripleTerms: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sizes') args.sizes = argv[++i].split(',').map(Number);
    else if (arg.startsWith('--sizes=')) args.sizes = arg.slice('--sizes='.length).split(',').map(Number);
    else if (arg === '--no-n3') args.includeN3 = false;
    else if (arg === '--no-graphy') args.includeGraphy = false;
    else if (arg === '--no-triple-terms') args.includeTripleTerms = false;
    else if (arg === '--triple-terms') args.includeTripleTerms = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function iri(local) {
  return `<http://example.org/${local}>`;
}

function generateSyntheticNQuads(count, options = {}) {
  const includeTripleTerms = options.includeTripleTerms !== false;
  const lines = new Array(count);
  for (let i = 0; i < count; i++) {
    const s = iri(`s${i}`);
    const p = iri(`p${i % 17}`);
    const g = iri(`g${i % 11}`);
    switch (i % 8) {
      case 0:
        lines[i] = `${s} ${p} ${iri(`o${i}`)} .`;
        break;
      case 1:
        lines[i] = `${s} ${p} "literal ${i}" .`;
        break;
      case 2:
        lines[i] = `${s} ${p} "${i}"^^<http://www.w3.org/2001/XMLSchema#integer> ${g} .`;
        break;
      case 3:
        lines[i] = `${s} ${p} "hello ${i}"@en ${g} .`;
        break;
      case 4:
        lines[i] = `${s} ${p} "${i}.5"^^<http://www.w3.org/2001/XMLSchema#decimal> .`;
        break;
      case 5:
        lines[i] = `${s} ${p} "true"^^<http://www.w3.org/2001/XMLSchema#boolean> ${g} .`;
        break;
      case 6:
        lines[i] = includeTripleTerms
          ? `${s} ${iri('assertedBy')} <<(${s} ${p} ${iri(`o${i}`)})>> ${g} .`
          : `${s} ${iri('assertedBy')} "source ${i}" ${g} .`;
        break;
      default:
        lines[i] = includeTripleTerms
          ? `${s} ${p} <<(${iri(`nested${i}`)} ${iri('knows')} "friend ${i}")>> ${g} .`
          : `${s} ${p} "friend ${i}" ${g} .`;
        break;
    }
  }
  return `${lines.join('\n')}\n`;
}

async function bench(label, input, run) {
  if (global.gc) global.gc();
  const startMemory = process.memoryUsage().rss;
  let peakMemory = startMemory;
  // Sample the resident set size while parsing, since a streaming parser releases its memory by the end
  const sampler = setInterval(() => {
    peakMemory = Math.max(peakMemory, process.memoryUsage().rss);
  }, 5);
  const start = process.hrtime.bigint();
  const parsed = await run();
  const elapsedSeconds = Number(process.hrtime.bigint() - start) / 1e9;
  clearInterval(sampler);
  peakMemory = Math.max(peakMemory, process.memoryUsage().rss);
  return {
    label,
    parsed,
    seconds: elapsedSeconds,
    triplesPerSecond: parsed / elapsedSeconds,
    mbInput: Buffer.byteLength(input) / 1024 / 1024,
    mbPeakRssDelta: (peakMemory - startMemory) / 1024 / 1024,
  };
}

/** A readable stream over `input` in 64 KiB chunks, created lazily so the chunks are not all held at once. */
function inputStream(input) {
  return Readable.from((function* chunks() {
    for (let i = 0; i < input.length; i += CHUNK_SIZE) yield input.slice(i, i + CHUNK_SIZE);
  })(), { objectMode: false });
}

/** Pipes the input through a streaming parser and counts the emitted items without keeping them. */
function countStream(parser, input) {
  return new Promise((resolve, reject) => {
    let parsed = 0;
    const source = inputStream(input);
    source.on('error', reject);
    parser.on('data', () => { parsed++; });
    parser.on('error', reject);
    parser.on('end', () => resolve(parsed));
    source.pipe(parser);
  });
}

function printResult(size, result) {
  console.log([
    String(size).padStart(9),
    result.label.padEnd(20),
    `${result.seconds.toFixed(3)}s`.padStart(10),
    `${Math.round(result.triplesPerSecond).toLocaleString()} q/s`.padStart(18),
    `${result.mbInput.toFixed(1)} MiB`.padStart(12),
    `${result.mbPeakRssDelta.toFixed(1)} MiB peak RSSΔ`.padStart(21),
  ].join('  '));
}

function parseWithOwn(input, relax) {
  return countStream(new StreamParser({ format: 'N-Quads', relax }), input);
}

function parseWithN3(input) {
  return countStream(new N3StreamParser({ format: 'N-Quads' }), input);
}

function parseWithGraphy(input, relax) {
  if (!graphyNQuadsRead) throw new Error('@graphy/content.nq.read is not installed');
  return countStream(graphyNQuadsRead({ relax }), input);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('     size  parser                      time          throughput         input                 memory');
  console.log('---------  --------------------  ----------  ------------------  ------------  ---------------------');
  if (args.includeTripleTerms && args.includeGraphy) {
    console.log('# Note: Graphy 4.x N-Quads readers do not parse RDF1.2 triple terms; use --no-triple-terms for direct Graphy numbers.');
  }
  for (const size of args.sizes) {
    const input = generateSyntheticNQuads(size, { includeTripleTerms: args.includeTripleTerms });
    // Warm up both parser implementations on a small prefix of the generated data.
    const warmupInput = input.split('\n').slice(0, Math.min(1000, size)).join('\n');
    await parseWithOwn(warmupInput, false);
    await parseWithOwn(warmupInput, true);
    if (args.includeN3) {
      try { await parseWithN3(warmupInput); } catch { /* Older N3 versions may reject RDF1.2 triple terms. */ }
    }
    if (args.includeGraphy && !args.includeTripleTerms) {
      try { await parseWithGraphy(warmupInput, true); } catch { /* Graphy may reject generated input if unsupported. */ }
    }

    const own = await bench('rdf-parser-ts', input, () => parseWithOwn(input, false));
    printResult(size, own);

    const ownRelax = await bench('rdf-parser-ts/relax', input, () => parseWithOwn(input, true));
    printResult(size, ownRelax);

    if (args.includeN3) {
      try {
        const n3 = await bench('n3', input, () => parseWithN3(input));
        printResult(size, n3);
      } catch (error) {
        console.log(`${String(size).padStart(9)}  ${'n3'.padEnd(20)}  skipped: ${error.message}`);
      }
    }

    if (args.includeGraphy) {
      if (args.includeTripleTerms) {
        console.log(`${String(size).padStart(9)}  ${'graphy'.padEnd(20)}  skipped: RDF1.2 triple terms not supported by @graphy/content.nq.read`);
      } else {
        try {
          const graphy = await bench('graphy', input, () => parseWithGraphy(input, false));
          printResult(size, graphy);
        } catch (error) {
          console.log(`${String(size).padStart(9)}  ${'graphy'.padEnd(20)}  skipped: ${error.message}`);
        }
        try {
          const graphyRelax = await bench('graphy/relax', input, () => parseWithGraphy(input, true));
          printResult(size, graphyRelax);
        } catch (error) {
          console.log(`${String(size).padStart(9)}  ${'graphy/relax'.padEnd(20)}  skipped: ${error.message}`);
        }
      }
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { generateSyntheticNQuads };
