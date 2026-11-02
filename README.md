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
