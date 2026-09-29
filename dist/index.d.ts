import * as RDF from '@rdfjs/types';
import { Transform, TransformOptions, Readable } from 'readable-stream';

interface ParserOptions {
    /** Base IRI against which relative IRIs are resolved. */
    baseIRI?: string;
    /** Alias of `baseIRI`, kept for compatibility with N3.js options. */
    baseIRIPath?: string;
    /**
     * Format hint, such as `text/turtle`, `application/trig`, `application/n-triples` or `application/n-quads`.
     * N-Triples and N-Quads enable strict line-based validation; without a hint, Turtle/TriG syntax is accepted.
     */
    format?: string;
    /** RDF/JS data factory used to create terms and quads. Defaults to the `DataFactory` of rdf-data-factory. */
    factory?: RDF.DataFactory<RDF.BaseQuad>;
    /** Emit comment events in streaming mode. */
    comments?: boolean;
    /** Skip part of the validation on hot N-Triples/N-Quads paths in exchange for throughput. */
    relax?: boolean;
    /** Force RDF Messages mode. */
    rdfMessages?: boolean;
    /** Alias of `rdfMessages`. */
    messages?: boolean;
    /** Accept unsupported version labels, for compatibility with N3.js options. */
    parseUnsupportedVersions?: boolean;
    /** Initial RDF version label; a `*-messages` label enables RDF Messages mode. */
    version?: string;
}
interface StreamParserOptions extends ParserOptions, TransformOptions {
}
type TransformCallback = (error?: Error | null) => void;
/** A quad annotated with the RDF Message it belongs to, emitted in RDF Messages mode. */
interface MessageQuad {
    quad: RDF.BaseQuad;
    /** Zero-based index of the message, incremented at every `MESSAGE` delimiter. */
    messageCounter: number;
}
type ParserOutput = RDF.BaseQuad[] | MessageQuadArray;
type ParserOutputItem = RDF.BaseQuad | MessageQuad;
type ParseCallback = (error: Error | null, quad?: RDF.BaseQuad | null, prefixes?: Record<string, RDF.NamedNode>, messageCounter?: number) => void;
/** Parser output in RDF Messages mode, which also records the number of messages (including empty ones). */
interface MessageQuadArray extends Array<MessageQuad> {
    messageCount: number;
}
interface ParserEventCallbacks {
    prefix?: (prefix: string, iri: RDF.NamedNode) => void;
    comment?: (comment: string) => void;
}
/**
 * The quads of a single RDF Message. RDF/JS has no notion of messages, so this is the one
 * data model class this package adds to the RDF/JS interfaces.
 */
declare class Message extends Array<RDF.BaseQuad> {
    readonly messageCounter: number;
    static get [Symbol.species](): ArrayConstructor;
    constructor(messageCounter: number, quads?: Iterable<RDF.BaseQuad>);
}
/**
 * Parses a complete Turtle, TriG, N-Triples or N-Quads document held in memory.
 *
 * For input that arrives in chunks, use {@link StreamParser} (Node.js streams) or
 * {@link IncrementalParser} (plain `write()`/`end()` calls).
 */
declare class Parser {
    private readonly options;
    constructor(options?: ParserOptions);
    /**
     * Parses `input` and returns all quads, or `{ quad, messageCounter }` entries in RDF Messages mode.
     * When a callback is passed, it is called once per quad, then once with `quad === null`, and nothing is returned.
     */
    parse(input: string): ParserOutput;
    parse(input: string, callback: ParseCallback): undefined;
    /** Parses `input` in RDF Messages mode and groups the quads per message. */
    parseMessages(input: string): Message[];
}
/**
 * Push-based parser for input that arrives in chunks, independent of any stream implementation.
 *
 * The core parser only works on a complete string. `IncrementalParser` buffers the chunks passed to
 * {@link IncrementalParser.write}, hands every complete statement prefix of that buffer to the core parser,
 * and keeps only the incomplete remainder together with the parser state (prefixes, base IRI, blank node labels,
 * message counters) for the next chunk. Both {@link StreamParser} and the Web Streams parser in the browser
 * entry are thin wrappers around it.
 */
declare class IncrementalParser {
    private readonly options;
    private readonly callbacks;
    private parserState;
    private pending;
    private atStart;
    private readonly lineFormat;
    constructor(options?: ParserOptions, callbacks?: ParserEventCallbacks);
    /** Adds a chunk of input and returns the output of all statements that are complete so far. */
    write(input: string): ParserOutputItem[];
    /** Adds an optional last chunk, parses all remaining input and returns its output. */
    end(input?: string): ParserOutputItem[];
    private appendInput;
    /**
     * The end of the last complete statement in the pending input. In N-Triples and N-Quads a statement cannot span
     * lines, so that is the last line break; the other formats need a scan that tracks strings, IRIs and nesting.
     */
    private findCompleteEnd;
    private parsePending;
}
/**
 * Node.js-style `Transform` stream (based on `readable-stream`, so it also works in bundled browser code)
 * that accepts string or byte chunks and emits RDF/JS quads, or `{ quad, messageCounter }` entries in RDF Messages
 * mode.
 * Emits `prefix`, `comment` and `messageCounter` events.
 */
declare class StreamParser extends Transform {
    private readonly decoder;
    private readonly parser;
    constructor(options?: StreamParserOptions);
    /** Pipes `stream` into this parser, forwarding its errors, and returns this parser. */
    import(stream: Readable | NodeJS.ReadableStream): this;
    _transform(chunk: string | Uint8Array, _encoding: BufferEncoding, callback: TransformCallback): void;
    _flush(callback: TransformCallback): void;
    private run;
}
/** Type guard for the `{ quad, messageCounter }` entries emitted in RDF Messages mode. */
declare function isMessageQuad(value: unknown): value is MessageQuad;
/**
 * Groups parser output into one {@link Message} per RDF Message, preserving empty messages.
 * Plain quads are all assigned to message 0.
 */
declare function toMessages(output: Iterable<ParserOutputItem>, messageCount?: number): Message[];

export { IncrementalParser, Message, type MessageQuad, type MessageQuadArray, type ParseCallback, Parser, type ParserEventCallbacks, type ParserOptions, type ParserOutput, type ParserOutputItem, StreamParser, type StreamParserOptions, isMessageQuad, toMessages };
