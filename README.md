# RDF Parser for TypeScript

[![CI](https://github.com/pietercolpaert/rdf-parser-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/pietercolpaert/rdf-parser-ts/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/pietercolpaert/rdf-parser-ts/badge.svg?branch=main)](https://coveralls.io/github/pietercolpaert/rdf-parser-ts?branch=main)
[![npm version](https://img.shields.io/npm/v/rdf-parser-ts.svg)](https://www.npmjs.com/package/rdf-parser-ts)

Fast RDF/JS parsing for Turtle, TriG, N-Triples, N-Quads, RDF 1.2 triple terms, and RDF Message Logs in Node.js and browsers.

This parser is used in the browser by the [ldfetch playground](https://www.pieter.pm/ldfetch/#url=https%3A%2F%2Fwww.pieter.pm%2Fldfetch%2Fexamples%2Fsensor-readings.trig&format=trig&scope=memory&view=timeseries&message=1). The linked example parses sensor readings sent as RDF Messages in TriG and shows them as a time series.

This implementation has been built with a clear scope in mind: RDF 1.2 compliance for parsing these 4 formats with RDF Messages support using the RDF/JS data model. We will explicitly never support storing data or reasoning.

We have a sibling package for writing data called [rdf-writer-ts](https://github.com/pietercolpaert/rdf-writer-ts).

> [!NOTE]
> I built this as an agentic coding experiment for myself. I’m happy to see spec compliance and RDF Messages support, but integration tests with other software will need to show whether this work is as maintainable and useful as other libraries. This project would not have been possible without Blake Regalia’s work on Graphy and Ruben Verborgh’s work on N3.js.

## Install

```sh
npm install rdf-parser-ts
```

## Parsing strings

```ts
import { Parser } from 'rdf-parser-ts';

const parser = new Parser({ baseIRI: 'http://example.org/' });
const quads = parser.parse(`
	@prefix ex: <http://example.com/>.
	ex:s ex:p "hello"@en;
	     ex:n 42;
	     a ex:Thing.
`);

for (const quad of quads) {
	if ('subject' in quad) {
		console.log(quad.subject.termType, quad.predicate.value, quad.object.value);
	}
}
```

`parse()` returns an array of [RDF/JS quads](https://rdf.js.org/data-model-spec/#quad-interface). In [RDF Messages](#rdf-messages) mode, it returns `{ quad, messageCounter }` entries instead, which is why its item type is `RDF.BaseQuad | MessageQuad`; the check on `'subject'` narrows it to a quad.

With a callback, `parse()` returns `undefined` and follows the N3.js callback flow: the callback is called once per quad, then once with `quad === null` and the prefixes, or once with an error.

```ts
new Parser().parse('<http://ex.org/s> <http://ex.org/p> <http://ex.org/o>.', (error, quad, prefixes) => {
	if (error) throw error;
	if (quad) console.log(quad.subject.value);
	else console.log('done', prefixes);
});
```

### Parser options

- `baseIRI` / `baseIRIPath`: base IRI to resolve relative IRIs against, with the RFC 3986 algorithm. Absolute IRIs are kept as written.
- `format`: format hint, such as `text/turtle`, `application/trig`, `application/n-triples`, or `application/n-quads`. N-Triples and N-Quads enable strict line-based validation, Turtle rejects graphs, and Turtle and TriG reject quads. Without a hint, any of the four syntaxes is accepted.
- `factory`: the [RDF/JS `DataFactory`](https://rdf.js.org/data-model-spec/#datafactory-interface) that creates the terms and quads. Defaults to the `DataFactory` of [rdf-data-factory](https://github.com/rubensworks/rdf-data-factory.js).
- `relax`: skip part of the validation on N-Triples/N-Quads hot paths, for trusted generated input.
- `rdfMessages` / `messages`: force RDF Messages mode.
- `version`: initial RDF version label; a messages version such as `1.2-messages` enables RDF Messages mode.
- `parseUnsupportedVersions`: accept `VERSION` labels other than `1.1`, `1.2`, `1.2-basic`, and `*-messages`, which are rejected by default.
- `comments`: accepted for compatibility with N3.js options. Comment events are always emitted by the stream parsers and `IncrementalParser`.

## RDF/JS data model

Terms and quads are created by an RDF/JS data factory. By default that is `new DataFactory()` from [rdf-data-factory](https://github.com/rubensworks/rdf-data-factory.js), and any other factory can be passed with the `factory` option, for instance to produce terms of your own RDF/JS implementation:

```ts
import { DataFactory } from 'rdf-data-factory';
import { Parser } from 'rdf-parser-ts';

const factory = new DataFactory({ blankNodePrefix: 'doc1_' });
const quads = new Parser({ factory }).parse('<http://ex.org/s> <http://ex.org/p> "o"@en--ltr .');
```

All public types are the [`@rdfjs/types`](https://github.com/rdfjs/types) interfaces. `Message` is the only class this package adds, because RDF/JS has no notion of RDF Messages. RDF 1.2 triple terms are quads in the object position, and base directions are available as `literal.direction`. Quads are typed as `RDF.BaseQuad` rather than `RDF.Quad`, because a custom factory decides which quad type it produces.

To serialize quads, use a writer such as [rdf-writer-ts](https://github.com/pietercolpaert/rdf-writer-ts).

## API and types

```ts
import type * as RDF from '@rdfjs/types';

class Parser {
	constructor(options?: ParserOptions);
	parse(input: string): ParserOutput;
	parse(input: string, callback: ParseCallback): undefined;
	/** Parses in RDF Messages mode and groups the quads per message. */
	parseMessages(input: string): Message[];
}

/** Push-based parser for chunked input, independent of any stream implementation. */
class IncrementalParser {
	constructor(options?: ParserOptions, callbacks?: ParserEventCallbacks);
	/** Returns the output of all statements that are complete so far. */
	write(chunk: string): ParserOutputItem[];
	/** Parses the remaining input. */
	end(chunk?: string): ParserOutputItem[];
}

/** Node.js-style Transform stream (readable-stream) in object mode; emits ParserOutputItems. */
class StreamParser extends Transform {
	constructor(options?: StreamParserOptions);
	/** Pipes a stream into this parser, forwarding its errors. */
	import(stream: Readable | NodeJS.ReadableStream): this;
	// Events: 'data' (ParserOutputItem), 'prefix' (prefix: string, iri: RDF.NamedNode),
	// 'comment' (comment: string), 'messageCounter' (counter: number, quad: RDF.BaseQuad)
}

/** The quads of one RDF Message. */
class Message extends Array<RDF.BaseQuad> {
	readonly messageCounter: number;
}

function isMessageQuad(value: unknown): value is MessageQuad;
/** Groups parser output per message; plain quads all belong to message 0. */
function toMessages(output: Iterable<ParserOutputItem>, messageCount?: number): Message[];

interface ParserOptions {
	baseIRI?: string;
	baseIRIPath?: string;
	format?: string;
	factory?: RDF.DataFactory<RDF.BaseQuad>;
	relax?: boolean;
	rdfMessages?: boolean;
	messages?: boolean;
	version?: string;
	parseUnsupportedVersions?: boolean;
	comments?: boolean;
}
interface StreamParserOptions extends ParserOptions, TransformOptions {}

/** Emitted in RDF Messages mode */
interface MessageQuad {
	quad: RDF.BaseQuad;
	messageCounter: number;
}
/** Output in RDF Messages mode, including the number of messages (empty ones too) */
interface MessageQuadArray extends Array<MessageQuad> {
	messageCount: number;
}
type ParserOutputItem = RDF.BaseQuad | MessageQuad;
type ParserOutput = RDF.BaseQuad[] | MessageQuadArray;

type ParseCallback = (
	error: Error | null,
	quad?: RDF.BaseQuad | null,
	prefixes?: Record<string, RDF.NamedNode>,
	messageCounter?: number,
) => void;
interface ParserEventCallbacks {
	prefix?: (prefix: string, iri: RDF.NamedNode) => void;
	comment?: (comment: string) => void;
}
```

The browser entry (`rdf-parser-ts/browser`) exports the same `Parser`, `IncrementalParser`, `Message`, `isMessageQuad`, `toMessages`, and types, with a Web Streams based `StreamParser` instead:

```ts
class StreamParser {
	constructor(options?: ParserOptions);
	readonly readable: ReadableStream<ParserOutputItem>;
	readonly writable: WritableStream<string | Uint8Array | ArrayBuffer>;
	import(stream: ReadableStream<string | Uint8Array | ArrayBuffer>): ReadableStream<ParserOutputItem>;
	on(event: 'prefix' | 'comment' | 'messageCounter', listener: (...args: any[]) => void): this;
	addEventListener(event: 'prefix' | 'comment' | 'messageCounter', listener: (...args: any[]) => void): this;
}
```

How the parsers relate: the internal core parser is a recursive-descent parser over one complete string. `Parser` runs it once over the whole input. `IncrementalParser` buffers chunks, runs the core parser on every complete statement prefix, and carries the parser state (prefixes, base IRI, blank node labels, message counters) over to the next chunk. Both `StreamParser`s are thin wrappers around `IncrementalParser`.

## RDF Messages

RDF Messages mode is enabled automatically when the input contains a messages version label, such as `VERSION "1.2-messages"` or `@version "1.2-messages" .`. It can also be enabled explicitly with `rdfMessages: true` or `messages: true`.

In RDF Messages mode, `parse()` returns a `MessageQuadArray`: entries with both the parsed quad and the message counter. Counters start at `0` and increase at each `MESSAGE` or `@message .` delimiter.

```ts
import { Parser, isMessageQuad } from 'rdf-parser-ts';

const output = new Parser().parse(`
	VERSION "1.2-messages"
	<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .
	MESSAGE
	<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .
`);

for (const entry of output) {
	if (isMessageQuad(entry)) {
		console.log(entry.messageCounter, entry.quad.subject.value);
	}
}
```

The callback form still passes quads, with the message counter as an extra argument.

Use `toMessages()` to group parser output into `Message` instances. Empty messages are preserved when the input contains delimiters before the first quad or between two delimiters.

```ts
import { Parser, toMessages } from 'rdf-parser-ts';

const output = new Parser({ rdfMessages: true }).parse(`
	MESSAGE
	<http://example.org/s> <http://example.org/p> <http://example.org/o> .
`);

const messages = toMessages(output);
console.log(messages[0]?.length); // 0
console.log(messages[1]?.length); // 1
```

For direct message-level parsing, use `parseMessages()`:

```ts
const messages = new Parser({ baseIRI: 'http://example.org/' }).parseMessages(`
	VERSION "1.2-messages"
	<s1> <p> <o1> .
	MESSAGE
	<s2> <p> <o2> .
`);
```

Blank node labels are scoped per message in RDF Messages mode, so the same blank node label in two messages produces distinct blank node terms.

## Streaming and incremental parsing

`StreamParser` is a Node.js `Transform` stream in object mode, built on [readable-stream](https://github.com/nodejs/readable-stream) so it also works when bundled for browsers. It accepts string or `Buffer` chunks and emits quads, or `{ quad, messageCounter }` entries plus a `messageCounter` event in RDF Messages mode.

```ts
import { createReadStream } from 'node:fs';
import type * as RDF from '@rdfjs/types';
import { StreamParser } from 'rdf-parser-ts';

const parser = new StreamParser({
	baseIRI: 'http://example.org/',
	format: 'application/n-quads',
});

createReadStream('data.nq')
	.pipe(parser)
	.on('data', (quad: RDF.BaseQuad) => {
		console.log(quad.subject.value, quad.predicate.value, quad.object.value);
	})
	.on('prefix', (prefix: string, iri: RDF.NamedNode) => {
		console.log('prefix', prefix, iri.value);
	})
	.on('comment', (comment: string) => {
		console.log('comment', comment);
	});
```

The `import()` convenience method mirrors N3.js:

```ts
new StreamParser().import(createReadStream('data.ttl')).on('data', quad => console.log(quad));
```

`IncrementalParser` exposes the same chunking logic without any stream implementation:

```ts
import { IncrementalParser } from 'rdf-parser-ts';

const parser = new IncrementalParser({ baseIRI: 'http://example.org/' });
parser.write('<s> <p> "a" .\n<s> <p> "b');  // [quad for "a"]; the incomplete statement is buffered
parser.end('" .');                          // [quad for "b"]
```

## Browser usage

With a browser-aware bundler, import the browser entry explicitly:

```ts
import { Parser } from 'rdf-parser-ts/browser';

const quads = new Parser({ baseIRI: 'https://example.org/' }).parse('<s> <p> <o>.');
```

For direct browser usage through a CDN, use the ESM bundle:

```html
<script type="module">
	import { Parser } from 'https://cdn.jsdelivr.net/npm/rdf-parser-ts/dist/browser/index.mjs';

	const quads = new Parser({ baseIRI: 'https://example.org/' }).parse('<s> <p> <o>.');
	console.log(quads[0].subject.value);
</script>
```

Or use the global bundle, which exposes `RDFParserTS`:

```html
<script src="https://unpkg.com/rdf-parser-ts/dist/browser/index.global.js"></script>
<script>
	const { Parser } = RDFParserTS;
	const quads = new Parser({ baseIRI: 'https://example.org/' }).parse('<s> <p> <o>.');
	console.log(quads[0].subject.value);
</script>
```

For streaming in browsers, `StreamParser` works with Web Streams. It can be passed to `pipeThrough()` or used through its `import()` convenience method:

```ts
import { StreamParser } from 'rdf-parser-ts/browser';

const parser = new StreamParser({ baseIRI: 'https://example.org/' });
const rdfStream = new Blob([ '<s> <p>', ' <o>.' ]).stream();

for await (const item of rdfStream.pipeThrough(parser)) {
	console.log(item);
}
```

Browser bundle sizes after `npm run build`, with `gzip -9` for the compressed column:

| Bundle | Minified | gzip compressed |
| --- | ---: | ---: |
| `dist/browser/index.mjs` | 36,284 bytes (35.4 KiB) | 9,818 bytes (9.6 KiB) |
| `dist/browser/index.global.js` | 36,451 bytes (35.6 KiB) | 9,883 bytes (9.7 KiB) |

## Comunica and N3.js compatibility

The options and the `StreamParser` API follow N3.js, so a consumer such as Comunica's `ActorRdfParseN3` can swap `import { StreamParser } from 'n3'` for `import { StreamParser } from 'rdf-parser-ts'`:

```ts
import { StreamParser } from 'rdf-parser-ts';

const parser = new StreamParser({
	factory: dataFactory,
	baseIRI,
	format: mediaType,
	parseUnsupportedVersions: true,
	version,
});
```

## Development

```sh
npm run build           # Build CommonJS, ESM, declarations, and browser bundles
npm run typecheck       # Type-check with tsc --noEmit
npm run lint            # Lint with @rubensworks/eslint-config
npm test                # Run unit tests; fails below 100% coverage
npm run check           # Type-check, lint, build, then test
npm run ci              # Run check plus the performance regression warning check
npm run spec            # Run the W3C RDF 1.1 and RDF 1.2 test suites
npm run perf            # Compare string/stream reads and writes for 10^4 and 10^5 quads
npm run perf:quick      # Smaller benchmark for local iteration
npm run perf:regression # Compare the current build to a git baseline and warn on >20% throughput drops
npm run perf:graphy     # Benchmark without RDF 1.2 triple terms, so Graphy can take part
```

Package layout:

- `src/index.ts`: the parser, incremental parser, Node.js stream parser, and the RDF Messages helpers.
- `src/browser.ts`: the browser entry, with a Web Streams based `StreamParser`.
- `test/`: Vitest unit tests, including test cases replayed from N3.js.
- `spec/`: the `rdf-test-suite` adapter and EARL metadata.
- `perf/`: synthetic RDF and RDF Message benchmarks against N3.js and n3.js-messages, plus the original Graphy comparison.
- `dist/`: generated by `npm run build`, including Node.js builds and browser bundles.

## W3C RDF test suites

`npm run spec` runs the W3C test suites with [rdf-test-suite](https://github.com/rubensworks/rdf-test-suite.js), through the adapter in `spec/parser.cjs`, which pipes each test input into a `StreamParser`. All suites run without skipping any test:

| Suite | Tests |
| --- | ---: |
| RDF 1.1 N-Triples | 70 |
| RDF 1.1 N-Quads | 87 |
| RDF 1.1 Turtle | 313 |
| RDF 1.1 TriG | 357 |
| RDF 1.2 N-Triples syntax | 29 |
| RDF 1.2 N-Quads syntax | 27 |
| RDF 1.2 Turtle syntax | 74 |
| RDF 1.2 TriG syntax | 35 |
| RDF 1.2 Turtle evaluation | 32 |
| RDF 1.2 TriG evaluation | 26 |

Individual suites run with `npm run spec-1-1-turtle`, `npm run spec-1-2-trig-eval`, and so on. Generate EARL reports with `npm run spec-1-1-earl` or `npm run spec-1-2-earl`, and use `npm run spec-clean` to remove the manifest cache in `.rdf-test-suite-cache/`.

## N3.js parser tests

`test/n3-compat.test.ts` replays about 700 Turtle, TriG, N-Triples, N-Quads, and IRI-resolution cases from the [N3.js](https://github.com/rdfjs/N3.js) parser tests (N3-only syntax is left out). Results are compared up to blank node renaming. For invalid input, only the fact that parsing fails is checked, because error messages differ between implementations. The few N3.js cases that are corrected, with the reason, are listed in the test file.

The cases live in `test/fixtures/n3-parser-cases.json`. To regenerate them from an N3.js checkout that has been built:

```sh
npm run test:n3-extract -- ../N3.js
```

## Performance benchmarks

`npm run perf` compares this checkout of `rdf-parser-ts` with the installed [N3.js](https://github.com/rdfjs/N3.js) and [n3.js-messages](https://github.com/pietercolpaert/n3.js-messages). The new suite in `perf/compare.js` measures whole-string and streaming reads and writes, using N-Quads and TriG by default. N-Triples and Turtle are available through `--formats`.

```sh
npm run perf
npm run perf:quick
# Reproduce the report and save every timed sample:
npm run build
node --expose-gc perf/compare.js --json perf/latest.json
# Other syntaxes and small chunks:
node --expose-gc perf/compare.js --sizes 1000,10000 --formats N-Triples,Turtle --chunk-size 16
# Original streaming benchmark, including Graphy and relaxed validation:
node --expose-gc perf/bench.js --no-triple-terms
```

### Method and scope

Measured on 8 October 2026 with Node.js v25.9.0, Linux x64, Intel Core i7-1265U: **rdf-parser-ts 0.4.0 (local build), N3.js 2.13.11, n3.js-messages 0.1.1**. Tables show median throughput in **quads/second** over five samples after two untimed full-workload warmups. Implementation order rotates between samples, and garbage collection runs before each timed sample. The [raw results](perf/latest.json) include individual timings, input/output sizes, and environment details. These are synthetic measurements on one laptop; there is no older-version run here to establish how much N3.js improved between releases.

Each document mixes default and named graphs, IRI objects, plain, language-tagged, integer, decimal, and boolean literals. The RDF 1.2 and all message workloads additionally use triple terms for 25% of their objects. Message logs have one message, five quads per message, or 10,000 quads per message, with a version announcement and delimiters between messages. They contain no empty messages or blank nodes in the timed workload. Separate untimed checks exercise empty messages, repeated blank-node labels across scopes, and Unicode split into single-byte chunks.

Reads use the libraries' default data factories and strict validation in rdf-parser-ts. Whole-string message reads produce arrays of messages in both libraries. Streaming reads use identical UTF-8 Buffer chunks of 64 KiB through a pipeline into a consuming sink. On message logs, the rdf-parser-ts consumer groups `{ quad, messageCounter }` entries into arrays and retains only the current message, matching the add-on's message-level output. On ordinary RDF, rdf-parser-ts and N3.js stream individual quads; the add-on buffers the document as one message. This output difference is part of the cost shown. Quad values, ordering, counts, and message boundaries are checked before timing; counts are checked for every sample.

Writes receive prebuilt quad/message arrays, so data generation and parsing are outside the timed region. String writers create a complete string; stream writers feed a byte-counting sink. All writer outputs are parsed back and checked before timing. **rdf-parser-ts has no writer**; its sibling rdf-writer-ts is outside this comparison. N3.js supplies ordinary RDF writing; the add-on supplies message-log writing. An em dash means that API does not provide the corresponding operation. Plain N3.js alone does not provide the add-on's message grouping and blank-node scoping, so it is not timed as a message parser or writer.

Memory is not reported: the old in-process RSS sampler can miss allocations while synchronous parsing blocks the event loop, and sequential measurements also include allocator reuse. Whole-string APIs retain their complete output; message stream APIs retain at least the current message.

### Reading, side by side

Higher throughput is faster. All message workloads below include RDF 1.2 triple terms.

**100,000 quads** (one-message: 1 message; five-quads: 20,000 messages; large-message: 10 messages).

| Format | Workload | rdf-parser-ts string | N3.js string | n3.js-messages string | rdf-parser-ts stream | N3.js stream | n3.js-messages stream |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| N-Quads | Plain RDF | 793,708 | 462,071 | 445,739 | 531,029 | 391,887 | 356,782 |
| N-Quads | RDF 1.2 triple terms | 661,029 | 370,464 | 305,984 | 560,641 | 341,898 | 328,949 |
| N-Quads | 1 message | 513,452 | — | 333,386 | 470,725 | — | 308,748 |
| N-Quads | 5 quads/message | 603,806 | — | 317,213 | 361,226 | — | 240,601 |
| N-Quads | 10,000 quads/message | 425,863 | — | 214,445 | 340,788 | — | 244,332 |
| TriG | Plain RDF | 318,495 | 380,009 | 367,832 | 162,963 | 273,804 | 217,894 |
| TriG | RDF 1.2 triple terms | 309,188 | 314,629 | 305,764 | 178,378 | 257,851 | 237,297 |
| TriG | 1 message | 297,970 | — | 336,788 | 296,562 | — | 368,514 |
| TriG | 5 quads/message | 335,681 | — | 388,981 | 293,502 | — | 384,835 |
| TriG | 10,000 quads/message | 274,248 | — | 303,677 | 145,109 | — | 210,126 |

**10,000 quads** (one-message: 1 message; five-quads: 2,000 messages; large-message: 1 message).

| Format | Workload | rdf-parser-ts string | N3.js string | n3.js-messages string | rdf-parser-ts stream | N3.js stream | n3.js-messages stream |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| N-Quads | Plain RDF | 392,209 | 266,394 | 301,599 | 244,999 | 138,751 | 184,462 |
| N-Quads | RDF 1.2 triple terms | 383,139 | 276,509 | 259,991 | 207,745 | 117,315 | 150,013 |
| N-Quads | 1 message | 318,286 | — | 182,272 | 222,231 | — | 184,525 |
| N-Quads | 5 quads/message | 386,486 | — | 292,018 | 313,661 | — | 209,992 |
| N-Quads | 10,000 quads/message | 472,441 | — | 313,444 | 311,750 | — | 245,457 |
| TriG | Plain RDF | 246,695 | 336,660 | 305,513 | 109,783 | 119,721 | 140,456 |
| TriG | RDF 1.2 triple terms | 136,727 | 181,316 | 164,631 | 93,881 | 102,586 | 143,303 |
| TriG | 1 message | 191,130 | — | 249,896 | 146,203 | — | 225,628 |
| TriG | 5 quads/message | 178,855 | — | 220,043 | 102,401 | — | 189,981 |
| TriG | 10,000 quads/message | 163,409 | — | 186,915 | 118,961 | — | 155,936 |

### Writing

100,000 prebuilt quads; throughput in quads/second. The N3.js columns serialize ordinary RDF and the add-on columns serialize RDF Message Logs. These columns describe different output formats, rather than a direct speed comparison between equivalent writers. rdf-parser-ts writing is unavailable for every row.

| Format | Workload | N3.js string | N3.js stream | n3.js-messages string | n3.js-messages stream |
| --- | --- | ---: | ---: | ---: | ---: |
| N-Quads | Plain RDF | 1,540,718 | 715,160 | — | — |
| N-Quads | RDF 1.2 triple terms | 1,225,246 | 951,377 | — | — |
| N-Quads | 1 message | — | — | 662,763 | 700,994 |
| N-Quads | 5 quads/message | — | — | 638,696 | 361,602 |
| N-Quads | 10,000 quads/message | — | — | 1,072,157 | 786,953 |
| TriG | Plain RDF | 1,438,567 | 1,185,715 | — | — |
| TriG | RDF 1.2 triple terms | 1,345,591 | 930,140 | — | — |
| TriG | 1 message | — | — | 1,596,376 | 935,800 |
| TriG | 5 quads/message | — | — | 951,411 | 653,187 |
| TriG | 10,000 quads/message | — | — | 798,807 | 565,863 |

At 100,000 quads:

- Strict rdf-parser-ts reads ordinary N-Quads 1.36–1.78 times as fast as N3.js, across string/stream APIs and plain/triple-term inputs. Its N-Quads message reads are 1.39–1.99 times as fast as n3.js-messages.
- N3.js is faster on all four ordinary TriG read cases, and n3.js-messages is faster on all six TriG message read cases. The relative order depends on syntax, API, and message size; the tables give each case separately.

At 10,000 quads, the one-message and 10,000-quads/message documents are identical but measured separately; their differences illustrate run variability. The earlier README measurements used a different streaming harness and older packages, so they are not a controlled before/after comparison.

## Performance-oriented implementation notes

- The parser makes a single pass over the input string, tracks positions with numeric indexes, and avoids token objects.
- It emits quads directly from its parse routines.
- For N-Triples/N-Quads input, it uses a Graphy-inspired fast path for common escapeless statements, including RDF 1.2 triple terms, before falling back to the general parser. The fast path validates each IRI with a single regular expression test on the sliced value.
- The general parser builds IRIs and strings from slices of the input rather than character by character.
- Recurring predicate, datatype, and graph named nodes are cached in a bounded cache.
- `relax: true` mirrors Graphy's relaxed mode by skipping the IRI, language tag, and datatype checks on the fast path. The spec tests use strict validation.
- The stream parsers only retain the incomplete trailing input between chunks. For N-Triples and N-Quads that is everything after the last line break; for Turtle and TriG, a scan finds the end of the last complete statement. A single very large statement is still held until it ends.
- The Node.js `StreamParser` parses string chunks as they are, instead of letting the stream encode them to a Buffer and decoding them again.

## License

© Ghent University - IMEC

MIT Licensed
