#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { Readable, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const own = require('../dist');
const n3 = require('n3');
const messages = require('n3.js-messages');
const { generateSyntheticNQuads } = require('./bench');

function parseArgs(argv) {
  const args = { sizes: [10_000, 100_000], samples: 5, chunkSize: 64 * 1024, formats: ['N-Quads', 'TriG'], json: null };
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].split('=');
    const value = inline ?? argv[++i];
    if (key === '--sizes') args.sizes = value.split(',').map(Number);
    else if (key === '--samples') args.samples = Number(value);
    else if (key === '--chunk-size') args.chunkSize = Number(value);
    else if (key === '--formats') args.formats = value.split(',');
    else if (key === '--json') args.json = value;
    else throw new Error(`Unknown argument: ${key}`);
  }
  for (const value of [...args.sizes, args.samples, args.chunkSize])
    assert(Number.isSafeInteger(value) && value > 0, 'sizes, samples and chunk-size must be positive integers');
  assert(args.formats.every(format => ['N-Quads', 'N-Triples', 'Turtle', 'TriG'].includes(format)), 'Unsupported format');
  return args;
}

function document(size, format, tripleTerms, perMessage) {
  const lines = generateSyntheticNQuads(size, { includeTripleTerms: tripleTerms }).trimEnd().split('\n');
  const graphPattern = / (<http:\/\/example.org\/g\d+>) \.$/;
  const body = lines.map((line, i) => {
    // The generator puts graph labels only at the end; nested triples are left intact.
    const match = line.match(graphPattern);
    if (match) {
      const triple = line.slice(0, match.index) + ' .';
      line = format === 'TriG' ? `${match[1]} { ${triple} }` :
        format === 'N-Quads' ? line : triple;
    }
    return line + (perMessage && (i + 1) % perMessage === 0 && i + 1 < size ? '\nMESSAGE' : '');
  }).join('\n') + '\n';
  return (perMessage ? 'VERSION "1.2-messages"\n' : '') + body;
}

function source(input, chunkSize) {
  return Readable.from((function* () {
    for (let i = 0; i < input.length; i += chunkSize) yield input.subarray(i, i + chunkSize);
  })(), { objectMode: false });
}

function summarize(groups) {
  return { quads: groups.reduce((sum, group) => sum + group.length, 0), messages: groups.length };
}

async function readStream(library, input, format, messageMode, chunkSize, collect = false) {
  const parser = library === 'rdf-parser-ts' ? new own.StreamParser({ format }) :
    library === 'N3.js' ? new n3.StreamParser({ format }) : new messages.MessageStreamParser({ format });
  let quads = 0, messageCount = 0, current = [], counter = 0;
  const groups = [];
  const finishMessage = group => {
    messageCount++;
    if (collect) groups.push(group);
  };
  const sink = new Writable({ objectMode: true, write(item, encoding, done) {
    if (library === 'n3.js-messages') {
      quads += item.length;
      finishMessage(item);
    } else if (messageMode) {
      // Match the add-on's array-per-message allocation; retain only the current message.
      while (counter < item.messageCounter) {
        finishMessage(current);
        current = [];
        counter++;
      }
      current.push(item.quad);
      quads++;
    } else {
      quads++;
      if (collect) current.push(item);
    }
    done();
  }});
  await pipeline(source(input, chunkSize), parser, sink);
  if (library !== 'n3.js-messages') {
    if (messageMode) finishMessage(current);
    else { messageCount = 1; if (collect) groups.push(current); }
  }
  return collect ? groups : { quads, messages: messageCount };
}

function readString(library, input, format, messageMode, collect = false) {
  const groups = library === 'rdf-parser-ts' ? messageMode ? new own.Parser({ format }).parseMessages(input) :
    [new own.Parser({ format }).parse(input)] : library === 'N3.js' ? [new n3.Parser({ format }).parse(input)] :
    messages.parseMessages(input, { format });
  return collect ? groups : summarize(groups);
}

function writeString(library, groups, format) {
  if (library === 'n3.js-messages') return messages.writeMessages(groups, { format });
  return new Promise((resolve, reject) => {
    const writer = new n3.Writer({ format });
    writer.addQuads(groups[0]);
    writer.end((error, result) => error ? reject(error) : resolve(result));
  });
}

async function writeStream(library, groups, format, collect = false) {
  const writer = library === 'N3.js' ? new n3.StreamWriter({ format }) : new messages.MessageStreamWriter({ format });
  let bytes = 0;
  const chunks = [];
  const sink = new Writable({ write(chunk, encoding, done) {
    bytes += chunk.length;
    if (collect) chunks.push(chunk);
    done();
  }});
  await pipeline(Readable.from(library === 'N3.js' ? groups[0] : groups), writer, sink);
  return collect ? Buffer.concat(chunks).toString('utf8') : bytes;
}

function termKey(term) {
  if (term.termType === 'Quad') return quadKey(term);
  return [term.termType, term.value, term.language, term.direction, term.datatype?.value];
}
function quadKey(quad) { return [quad.subject, quad.predicate, quad.object, quad.graph].map(termKey); }
function groupKeys(groups) { return groups.map(group => Array.from(group, quadKey)); }

async function measure(cases, args, expected, details, results) {
  // Correctness and two warmups are outside the timed region. Unexpected errors fail the run.
  for (const entry of cases) {
    assert.deepEqual(await entry.run(), expected);
    assert.deepEqual(await entry.run(), expected);
    entry.seconds = [];
  }
  for (let sample = 0; sample < args.samples; sample++) {
    // Rotate the first implementation to reduce consistent order bias.
    for (let offset = 0; offset < cases.length; offset++) {
      const entry = cases[(sample + offset) % cases.length];
      if (global.gc) global.gc();
      const start = process.hrtime.bigint();
      const output = await entry.run();
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      assert.deepEqual(output, expected);
      entry.seconds.push(seconds);
    }
  }
  for (const entry of cases) {
    const sorted = [...entry.seconds].sort((a, b) => a - b);
    const seconds = sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] :
      (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const result = { ...details, library: entry.library, seconds, quadsPerSecond: details.size / seconds,
      messagesPerSecond: details.messageCount ? details.messageCount / seconds : null, samplesSeconds: entry.seconds };
    results.push(result);
    console.log(`${details.operation.padEnd(5)} ${details.mode.padEnd(6)} ${details.format.padEnd(8)} ${details.workload.padEnd(14)} ${String(details.size).padStart(7)} ${entry.library.padEnd(15)} ${seconds.toFixed(4)} s  ${Math.round(result.quadsPerSecond).toLocaleString()} q/s`);
  }
}

async function validateMessageSemantics() {
  const { isomorphic } = require('rdf-isomorphic');
  for (const format of ['N-Quads', 'TriG', 'N-Triples', 'Turtle']) {
    const input = 'VERSION "1.2-messages"\nMESSAGE\n' +
      '_:a <http://example.org/p> "héllo 🌍" .\n' +
      '_:a <http://example.org/p> "again" .\nMESSAGE\nMESSAGE\n' +
      '_:a <http://example.org/p> "last" .\n';
    for (const library of ['rdf-parser-ts', 'n3.js-messages']) {
      const groups = readString(library, input, format, true, true);
      assert.deepEqual(groups.map(group => group.length), [0, 2, 0, 1]);
      assert(groups[1][0].subject.equals(groups[1][1].subject), 'Blank node identity within a message');
      assert(!groups[1][0].subject.equals(groups[3][0].subject), 'Blank node scopes between messages');
      const streamed = await readStream(library, Buffer.from(input), format, true, 1, true);
      assert.deepEqual(streamed.map(group => group.length), [0, 2, 0, 1]);
      groups.forEach((group, i) => assert(isomorphic(group, streamed[i]), 'Byte-chunk parsing differs'));
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await validateMessageSemantics();
  const report = { measuredAt: new Date().toISOString(), environment: {
    node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model,
    versions: { 'rdf-parser-ts': require('../package.json').version, 'N3.js': require('n3/package.json').version,
      'n3.js-messages': require('n3.js-messages/package.json').version }, gc: Boolean(global.gc),
  }, options: args, results: [] };
  console.log(JSON.stringify(report.environment));
  for (const size of args.sizes) for (const format of args.formats) {
    for (const workload of [
      { name: 'plain', tripleTerms: false, perMessage: 0 },
      { name: 'triple-terms', tripleTerms: true, perMessage: 0 },
      { name: 'one-message', tripleTerms: true, perMessage: size },
      { name: 'messages-5', tripleTerms: true, perMessage: 5 },
      { name: 'messages-10000', tripleTerms: true, perMessage: 10_000 },
    ]) {
      const input = document(size, format, workload.tripleTerms, workload.perMessage);
      const buffer = Buffer.from(input);
      const messageMode = workload.perMessage > 0;
      const messageCount = messageMode ? Math.ceil(size / workload.perMessage) : 1;
      const libraries = messageMode ? ['rdf-parser-ts', 'n3.js-messages'] : ['rdf-parser-ts', 'N3.js', 'n3.js-messages'];
      const reference = readString('rdf-parser-ts', input, format, messageMode, true);
      assert.deepEqual(summarize(reference), { quads: size, messages: messageCount });
      for (const mode of ['string', 'stream']) {
        const cases = [];
        for (const library of libraries) {
          const parsed = mode === 'string' ? readString(library, input, format, messageMode, true) :
            await readStream(library, buffer, format, messageMode, args.chunkSize, true);
          assert.deepEqual(groupKeys(parsed), groupKeys(reference), `${library} ${mode}: quad values or message boundaries differ`);
          cases.push({ library, run: () => mode === 'string' ? readString(library, input, format, messageMode) :
            readStream(library, buffer, format, messageMode, args.chunkSize) });
        }
        await measure(cases, args, { quads: size, messages: messageCount },
          { operation: 'read', mode, format, workload: workload.name, size, messageCount, inputBytes: buffer.length }, report.results);
      }
      // rdf-parser-ts is a parser only. N3.js alone has no message-log writer.
      const writers = messageMode ? ['n3.js-messages'] : ['N3.js'];
      for (const mode of ['string', 'stream']) {
        for (const library of writers) {
          const serialized = mode === 'string' ? await writeString(library, reference, format) :
            await writeStream(library, reference, format, true);
          const roundtrip = readString('rdf-parser-ts', serialized, format, messageMode, true);
          assert.deepEqual(groupKeys(roundtrip), groupKeys(reference), `${library} ${mode}: writer roundtrip differs`);
          const bytes = Buffer.byteLength(serialized);
          const entry = { library, run: async () => ({ bytes: mode === 'string' ?
            Buffer.byteLength(await writeString(library, reference, format)) : await writeStream(library, reference, format) }) };
          await measure([entry], args, { bytes },
            { operation: 'write', mode, format, workload: workload.name, size, messageCount, outputBytes: bytes }, report.results);
        }
      }
    }
  }
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(report, null, 2) + '\n');
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { document, parseArgs };
