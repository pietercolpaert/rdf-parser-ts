import type * as RDF from '@rdfjs/types';
import { Transform, type TransformOptions, type Readable } from 'readable-stream';

export interface ParserOptions {
  /** Base IRI against which relative IRIs are resolved. */
  baseIRI?: string;
  /** Alias of `baseIRI`, kept for compatibility with N3.js options. */
  baseIRIPath?: string;
  /**
   * Format hint, such as `text/turtle`, `application/trig`, `application/n-triples` or `application/n-quads`.
   * N-Triples and N-Quads enable strict line-based validation; without a hint, Turtle/TriG syntax is accepted.
   */
  format?: string;
  /** RDF/JS data factory used to create terms and quads. Defaults to {@link DataFactory}. */
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

export interface StreamParserOptions extends ParserOptions, TransformOptions {}

type TransformCallback = (error?: Error | null) => void;

/** A quad annotated with the RDF Message it belongs to, emitted in RDF Messages mode. */
export interface MessageQuad {
  quad: RDF.BaseQuad;
  /** Zero-based index of the message, incremented at every `MESSAGE` delimiter. */
  messageCounter: number;
}

export type ParserOutput = RDF.BaseQuad[] | MessageQuadArray;
export type ParserOutputItem = RDF.BaseQuad | MessageQuad;
export type ParseCallback = (
  error: Error | null,
  quad?: RDF.BaseQuad | null,
  prefixes?: Record<string, RDF.NamedNode>,
  messageCounter?: number,
) => void;

/** Parser output in RDF Messages mode, which also records the number of messages (including empty ones). */
export interface MessageQuadArray extends Array<MessageQuad> {
  messageCount: number;
}

export interface ParserEventCallbacks {
  prefix?: (prefix: string, iri: RDF.NamedNode) => void;
  comment?: (comment: string) => void;
}

interface CoreParserResult {
  quads: RDF.BaseQuad[];
  messageQuads: MessageQuadArray;
  prefixes: Record<string, RDF.NamedNode>;
  messagesEnabled: boolean;
}

/** Parser state that is carried over between chunks when parsing incrementally. */
interface CoreParserState {
  prefixes: Record<string, RDF.NamedNode>;
  baseIRI: string;
  version?: string;
  messagesEnabled: boolean;
  messageCounter: number;
  messageCountHint: number;
  afterMessageDelimiter: boolean;
  localBlankNodeCounter: number;
  line: number;
  blankNodeLabels: Map<string, RDF.BlankNode>;
  namedNodeCache: Map<string, RDF.NamedNode>;
}

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDF_TYPE = `${RDF_NS}type`;
const RDF_REIFIES = `${RDF_NS}reifies`;
const RDF_FIRST = `${RDF_NS}first`;
const RDF_REST = `${RDF_NS}rest`;
const RDF_NIL = `${RDF_NS}nil`;
const RDF_LANG_STRING = `${RDF_NS}langString`;
const RDF_DIR_LANG_STRING = `${RDF_NS}dirLangString`;
const XSD_STRING = `${XSD}string`;
const XSD_INTEGER = `${XSD}integer`;
const XSD_DECIMAL = `${XSD}decimal`;
const XSD_DOUBLE = `${XSD}double`;
const XSD_BOOLEAN = `${XSD}boolean`;
type LiteralDirection = RDF.DirectionalLanguage['direction'];

function sameTerm(a: RDF.Term, b: RDF.Term | null | undefined): boolean {
  if (!b || a.termType !== b.termType || a.value !== b.value) {
    return false;
  }
  if (a.termType === 'Literal' && b.termType === 'Literal') {
    return a.language === b.language && a.direction === b.direction && a.datatype.equals(b.datatype);
  }
  if (a.termType === 'Quad' && b.termType === 'Quad') {
    return a.subject.equals(b.subject) && a.predicate.equals(b.predicate) &&
      a.object.equals(b.object) && a.graph.equals(b.graph);
  }
  return true;
}

export class NamedNode<Iri extends string = string> implements RDF.NamedNode<Iri> {
  public readonly termType = <const>'NamedNode';
  public constructor(public readonly value: Iri) {}
  public equals(other?: RDF.Term | null): boolean {
    return sameTerm(this, other);
  }
}

export class BlankNode implements RDF.BlankNode {
  public readonly termType = <const>'BlankNode';
  public constructor(public readonly value: string) {}
  public equals(other?: RDF.Term | null): boolean {
    return sameTerm(this, other);
  }
}

export class Variable implements RDF.Variable {
  public readonly termType = <const>'Variable';
  public constructor(public readonly value: string) {}
  public equals(other?: RDF.Term | null): boolean {
    return sameTerm(this, other);
  }
}

export class DefaultGraph implements RDF.DefaultGraph {
  public readonly termType = <const>'DefaultGraph';
  public readonly value = <const>'';
  public equals(other?: RDF.Term | null): boolean {
    return sameTerm(this, other);
  }
}

export class Literal implements RDF.Literal {
  public readonly termType = <const>'Literal';
  public readonly direction?: LiteralDirection;

  public constructor(
    public readonly value: string,
    public readonly language = '',
    public readonly datatype: RDF.NamedNode = new NamedNode(language ? RDF_LANG_STRING : XSD_STRING),
    direction?: LiteralDirection,
  ) {
    if (direction) {
      this.direction = direction;
    }
  }

  public equals(other?: RDF.Term | null): boolean {
    return sameTerm(this, other);
  }
}

export class Quad implements RDF.BaseQuad {
  public readonly termType = <const>'Quad';
  public readonly value = <const>'';

  public constructor(
    public readonly subject: RDF.Term,
    public readonly predicate: RDF.Term,
    public readonly object: RDF.Term,
    public readonly graph: RDF.Term = defaultGraphSingleton,
  ) {}

  public equals(other?: RDF.Term | null): boolean {
    return sameTerm(this, other);
  }
}

/**
 * The quads of a single RDF Message. RDF/JS has no notion of messages, so this is the one
 * data model class that goes beyond the RDF/JS interfaces.
 */
export class Message extends Array<RDF.BaseQuad> {
  public static override get [Symbol.species](): ArrayConstructor {
    return Array;
  }

  public constructor(public readonly messageCounter: number, quads: Iterable<RDF.BaseQuad> = []) {
    super();
    Object.setPrototypeOf(this, Message.prototype);
    for (const quad of quads) {
      this.push(quad);
    }
  }
}

const defaultGraphSingleton = new DefaultGraph();

let globalBlankNodeCounter = 0;

function isDirectionalLanguage(value: unknown): value is RDF.DirectionalLanguage {
  return Boolean(value && typeof value === 'object' && 'language' in value && !('termType' in value));
}

function fromTerm(original: RDF.NamedNode): NamedNode;
function fromTerm(original: RDF.BlankNode): BlankNode;
function fromTerm(original: RDF.Literal): Literal;
function fromTerm(original: RDF.Variable): Variable;
function fromTerm(original: RDF.DefaultGraph): DefaultGraph;
function fromTerm(original: RDF.BaseQuad): Quad;
function fromTerm(original: RDF.Term): RDF.Term;
function fromTerm(original: RDF.Term): RDF.Term {
  switch (original.termType) {
    case 'NamedNode':
      return new NamedNode(original.value);
    case 'BlankNode':
      return new BlankNode(original.value);
    case 'Variable':
      return new Variable(original.value);
    case 'DefaultGraph':
      return defaultGraphSingleton;
    case 'Literal':
      return new Literal(
        original.value,
        original.language,
        fromTerm(original.datatype),
        original.direction ?? undefined,
      );
    case 'Quad':
      return new Quad(
        fromTerm(original.subject),
        fromTerm(original.predicate),
        fromTerm(original.object),
        fromTerm(original.graph),
      );
  }
}

/** The default RDF/JS data factory. */
export const DataFactory = {
  namedNode: <Iri extends string = string>(value: Iri): NamedNode<Iri> => new NamedNode(value),
  blankNode: (value?: string): BlankNode => new BlankNode(value ?? `b${globalBlankNodeCounter++}`),
  literal: (value: string, languageOrDatatype?: string | RDF.NamedNode | RDF.DirectionalLanguage): Literal => {
    if (typeof languageOrDatatype === 'string') {
      const language = languageOrDatatype.toLowerCase();
      return new Literal(value, language, new NamedNode(language ? RDF_LANG_STRING : XSD_STRING));
    }
    if (isDirectionalLanguage(languageOrDatatype)) {
      const direction = languageOrDatatype.direction ?? undefined;
      return new Literal(
        value,
        languageOrDatatype.language.toLowerCase(),
        new NamedNode(direction ? RDF_DIR_LANG_STRING : RDF_LANG_STRING),
        direction,
      );
    }
    return new Literal(value, '', languageOrDatatype ?? new NamedNode(XSD_STRING));
  },
  variable: (value: string): Variable => new Variable(value),
  defaultGraph: (): DefaultGraph => defaultGraphSingleton,
  quad: (subject: RDF.Term, predicate: RDF.Term, object: RDF.Term, graph: RDF.Term = defaultGraphSingleton): Quad =>
    new Quad(subject, predicate, object, graph),
  fromTerm,
  fromQuad: (original: RDF.BaseQuad): Quad => fromTerm(original),
} satisfies RDF.DataFactory<RDF.BaseQuad>;

/**
 * Parses a complete Turtle, TriG, N-Triples or N-Quads document held in memory.
 *
 * For input that arrives in chunks, use {@link StreamParser} (Node.js streams) or
 * {@link IncrementalParser} (plain `write()`/`end()` calls).
 */
export class Parser {
  private readonly options: ParserOptions;

  public constructor(options: ParserOptions = {}) {
    this.options = options;
  }

  /**
   * Parses `input` and returns all quads, or `{ quad, messageCounter }` entries in RDF Messages mode.
   * When a callback is passed, it is called once per quad, then once with `quad === null`, and nothing is returned.
   */
  public parse(input: string, callback?: ParseCallback): ParserOutput | undefined {
    try {
      const result = new CoreParser(input, this.options, {}).parse();
      if (callback) {
        if (result.messagesEnabled) {
          for (const entry of result.messageQuads) {
            callback(null, entry.quad, result.prefixes, entry.messageCounter);
          }
        } else {
          for (const quad of result.quads) {
            callback(null, quad, result.prefixes);
          }
        }
        callback(null, null, result.prefixes);
        return undefined;
      }
      return result.messagesEnabled ? result.messageQuads : result.quads;
    } catch (error: unknown) {
      if (callback) {
        callback(error instanceof Error ? error : new Error(String(error)));
        return undefined;
      }
      throw error;
    }
  }

  /** Parses `input` in RDF Messages mode and groups the quads per message. */
  public parseMessages(input: string): Message[] {
    const result = new CoreParser(input, { ...this.options, rdfMessages: true }, {}).parse();
    return toMessages(result.messageQuads);
  }
}

function createInitialCoreParserState(options: ParserOptions): CoreParserState {
  return {
    prefixes: <Record<string, RDF.NamedNode>>Object.create(null),
    baseIRI: options.baseIRI ?? options.baseIRIPath ?? '',
    version: options.version,
    messagesEnabled: options.rdfMessages === true || options.messages === true || isMessagesVersion(options.version),
    messageCounter: 0,
    messageCountHint: 0,
    afterMessageDelimiter: false,
    localBlankNodeCounter: 0,
    line: 1,
    blankNodeLabels: new Map<string, RDF.BlankNode>(),
    namedNodeCache: new Map<string, RDF.NamedNode>(),
  };
}

function findCompleteParseEnd(input: string): number {
  let lastEnd = 0;
  let graphDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length;) {
    const code = input.charCodeAt(i);
    if (code === 35) {
      const end = scanCommentEnd(input, i);
      if (end < 0) {
        break;
      }
      i = end;
      continue;
    }
    if (code === 34 || code === 39) {
      const end = scanQuotedStringEnd(input, i);
      if (end < 0) {
        break;
      }
      i = end;
      continue;
    }
    if (code === 60 && input.charCodeAt(i + 1) !== 60) {
      const end = scanIriEnd(input, i);
      if (end < 0) {
        break;
      }
      i = end;
      continue;
    }

    if (code === 123) {
      graphDepth++;
    } else if (code === 125 && graphDepth > 0) {
      graphDepth--;
    } else if (code === 91 || code === 40) {
      bracketDepth++;
    } else if ((code === 93 || code === 41) && bracketDepth > 0) {
      bracketDepth--;
    } else if (code === 46 && graphDepth === 0 && bracketDepth === 0 && isStatementDotBoundary(input, i)) {
      const end = scanTrailingTriviaEnd(input, i + 1);
      lastEnd = end;
      i = end;
      continue;
    }

    i++;
  }

  return lastEnd;
}

function scanCommentEnd(input: string, index: number): number {
  for (let i = index + 1; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 10) {
      return i + 1;
    }
    if (code === 13) {
      return input.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
    }
  }
  return -1;
}

function scanQuotedStringEnd(input: string, index: number): number {
  const quote = input.charCodeAt(index);
  const triple = input.charCodeAt(index + 1) === quote && input.charCodeAt(index + 2) === quote;
  let i = index + (triple ? 3 : 1);
  while (i < input.length) {
    const code = input.charCodeAt(i);
    if (code === 92) {
      if (i + 1 >= input.length) {
        return -1;
      }
      i += 2;
      continue;
    }
    if (code === quote) {
      if (!triple) {
        return i + 1;
      }
      if (input.charCodeAt(i + 1) === quote && input.charCodeAt(i + 2) === quote) {
        return i + 3;
      }
    }
    i++;
  }
  return -1;
}

function scanIriEnd(input: string, index: number): number {
  for (let i = index + 1; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 92) {
      if (i + 1 >= input.length) {
        return -1;
      }
      i++;
      continue;
    }
    if (code === 62) {
      return i + 1;
    }
  }
  return -1;
}

function isStatementDotBoundary(input: string, index: number): boolean {
  const next = input.charCodeAt(index + 1);
  return !Number.isNaN(next) && (isWs(next) || next === 35);
}

function scanTrailingTriviaEnd(input: string, index: number): number {
  let i = index;
  while (i < input.length) {
    const code = input.charCodeAt(i);
    if (isWs(code)) {
      i++;
      continue;
    }
    if (code === 35) {
      const end = scanCommentEnd(input, i);
      if (end < 0) {
        return i;
      }
      i = end;
      continue;
    }
    break;
  }
  return i;
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
export class IncrementalParser {
  private parserState: CoreParserState;
  private pending = '';
  private atStart = true;

  public constructor(
    private readonly options: ParserOptions = {},
    private readonly callbacks: ParserEventCallbacks = {},
  ) {
    this.parserState = createInitialCoreParserState(options);
  }

  /** Adds a chunk of input and returns the output of all statements that are complete so far. */
  public write(input: string): ParserOutputItem[] {
    this.appendInput(input);
    return this.parsePending(false);
  }

  /** Adds an optional last chunk, parses all remaining input and returns its output. */
  public end(input = ''): ParserOutputItem[] {
    this.appendInput(input);
    return this.parsePending(true);
  }

  private appendInput(input: string): void {
    if (!input) {
      return;
    }
    if (this.atStart) {
      this.atStart = false;
      this.pending += input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
      return;
    }
    this.pending += input;
  }

  private parsePending(final: boolean): ParserOutputItem[] {
    const end = final ? this.pending.length : findCompleteParseEnd(this.pending);
    if (end <= 0 && !final) {
      return [];
    }

    const parser = new CoreParser(this.pending.slice(0, end), this.options, this.callbacks, this.parserState);
    const result = parser.parse(final);
    this.parserState = parser.exportState();
    this.pending = this.pending.slice(end);

    return result.messagesEnabled ? result.messageQuads : result.quads;
  }
}

/**
 * Node.js-style `Transform` stream (based on `readable-stream`, so it also works in bundled browser code)
 * that accepts string or byte chunks and emits RDF/JS quads, or `{ quad, messageCounter }` entries in RDF Messages
 * mode.
 * Emits `prefix`, `comment` and `messageCounter` events.
 */
export class StreamParser extends Transform {
  private readonly decoder = new TextDecoder();
  private readonly parser: IncrementalParser;

  public constructor(options: StreamParserOptions = {}) {
    const {
      baseIRI,
      baseIRIPath,
      format,
      factory,
      comments,
      relax,
      rdfMessages,
      messages,
      parseUnsupportedVersions,
      version,
      ...streamOptions
    } = options;
    super({ ...streamOptions, readableObjectMode: true });
    this.parser = new IncrementalParser(
      {
        baseIRI,
        baseIRIPath,
        format,
        factory,
        comments,
        relax,
        rdfMessages,
        messages,
        parseUnsupportedVersions,
        version,
      },
      {
        prefix: (prefix, iri) => this.emit('prefix', prefix, iri),
        comment: comment => this.emit('comment', comment),
      },
    );
  }

  /** Pipes `stream` into this parser, forwarding its errors, and returns this parser. */
  public import(stream: Readable | NodeJS.ReadableStream): this {
    stream.on('error', (error: Error) => this.emit('error', error));
    stream.pipe(this);
    return this;
  }

  public override _transform(chunk: string | Uint8Array, _encoding: BufferEncoding, callback: TransformCallback): void {
    const input = typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    this.run(() => this.parser.write(input), callback);
  }

  public override _flush(callback: TransformCallback): void {
    this.run(() => this.parser.end(this.decoder.decode()), callback);
  }

  private run(parse: () => ParserOutputItem[], callback: TransformCallback): void {
    let items: ParserOutputItem[];
    try {
      items = parse();
    } catch (error: unknown) {
      callback(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    for (const item of items) {
      if (isMessageQuad(item)) {
        this.emit('messageCounter', item.messageCounter, item.quad);
      }
      this.push(item);
    }
    callback();
  }
}

/**
 * Recursive-descent parser over one complete string. It is not exported: {@link Parser} runs it once over the
 * whole input, while {@link IncrementalParser} runs it once per chunk and threads a {@link CoreParserState} through.
 */
class CoreParser {
  private readonly input: string;
  private readonly length: number;
  private index = 0;
  private line: number;
  private readonly factory: RDF.DataFactory<RDF.BaseQuad>;
  private readonly prefixes: Record<string, RDF.NamedNode>;
  private readonly quads: RDF.BaseQuad[] = [];
  private readonly messageQuads: MessageQuadArray = <MessageQuadArray>Object.assign([], { messageCount: 0 });
  private readonly callbacks: ParserEventCallbacks;
  private readonly strictNTriples: boolean;
  /** Whether the format is N-Triples or N-Quads, which enables the strict line-based grammar. */
  private readonly strictLineFormat: boolean;
  private readonly allowDotlessGraphTerminator: boolean;
  /** Whether graph blocks are allowed (TriG, and the format-agnostic default). */
  private readonly allowGraphs: boolean;
  /** Whether `subject predicate object graph .` statements are allowed (N-Quads, and the default). */
  private readonly allowQuadStatements: boolean;
  private readonly parseUnsupportedVersions: boolean;
  private readonly relax: boolean;
  private readonly defaultGraphTerm: RDF.DefaultGraph;
  private readonly namedNodeCache: Map<string, RDF.NamedNode>;
  private readonly blankNodeLabels: Map<string, RDF.BlankNode>;
  private baseIRI: string;
  private version?: string;
  private messagesEnabled: boolean;
  private messageCounter = 0;
  private messageCountHint = 0;
  private afterMessageDelimiter = false;
  private localBlankNodeCounter = 0;
  private fastEnd = 0;

  public constructor(input: string, options: ParserOptions, callbacks: ParserEventCallbacks, state?: CoreParserState) {
    this.input = state ? input : (input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input);
    this.length = this.input.length;
    this.factory = options.factory ?? DataFactory;
    this.prefixes = state?.prefixes ?? <Record<string, RDF.NamedNode>>Object.create(null);
    this.baseIRI = state?.baseIRI ?? options.baseIRI ?? options.baseIRIPath ?? '';
    this.callbacks = callbacks;
    this.relax = options.relax === true;
    this.defaultGraphTerm = this.factory.defaultGraph();
    this.version = state?.version ?? options.version;
    this.messagesEnabled = state?.messagesEnabled ??
      (options.rdfMessages === true || options.messages === true || isMessagesVersion(options.version));
    this.messageCounter = state?.messageCounter ?? 0;
    this.messageCountHint = state?.messageCountHint ?? 0;
    this.afterMessageDelimiter = state?.afterMessageDelimiter ?? false;
    this.localBlankNodeCounter = state?.localBlankNodeCounter ?? 0;
    this.line = state?.line ?? 1;
    this.blankNodeLabels = state?.blankNodeLabels ?? new Map<string, RDF.BlankNode>();
    this.namedNodeCache = state?.namedNodeCache ?? new Map<string, RDF.NamedNode>();
    const format = typeof options.format === 'string' ? options.format.toLowerCase() : '';
    this.strictNTriples = format.includes('n-triples');
    this.strictLineFormat = this.strictNTriples || format.includes('n-quads');
    this.allowDotlessGraphTerminator = format === '' || format.includes('trig');
    this.allowGraphs = !this.strictNTriples && !format.includes('turtle');
    this.allowQuadStatements = format === '' || format.includes('n-quads');
    this.parseUnsupportedVersions = options.parseUnsupportedVersions === true;
  }

  public parse(final = true): CoreParserResult {
    while (true) {
      this.skipWsAndComments();
      if (this.index >= this.length) {
        if (final) {
          this.finalizeEndOfFileMessage();
        }
        return {
          quads: this.quads,
          messageQuads: this.messageQuads,
          prefixes: this.prefixes,
          messagesEnabled: this.messagesEnabled,
        };
      }
      if (this.strictLineFormat && this.tryParseLineStatementFast()) {
        continue;
      }
      this.parseStatement(this.defaultGraphTerm);
    }
  }

  public exportState(): CoreParserState {
    return {
      prefixes: this.prefixes,
      baseIRI: this.baseIRI,
      version: this.version,
      messagesEnabled: this.messagesEnabled,
      messageCounter: this.messageCounter,
      messageCountHint: this.messageCountHint,
      afterMessageDelimiter: this.afterMessageDelimiter,
      localBlankNodeCounter: this.localBlankNodeCounter,
      line: this.line,
      blankNodeLabels: this.blankNodeLabels,
      namedNodeCache: this.namedNodeCache,
    };
  }

  private tryParseLineStatementFast(): boolean {
    let i = this.index;

    const subject = this.readFastNode(i, false);
    if (!subject) {
      return false;
    }
    i = this.skipHws(this.fastEnd);

    const predicateEnd = this.readFastIriEnd(i);
    if (predicateEnd < 0) {
      return false;
    }
    const predicate = this.cachedNamedNode(this.input.slice(i + 1, predicateEnd));
    i = this.skipHws(predicateEnd + 1);

    const object = this.readFastObject(i);
    if (!object) {
      return false;
    }
    i = this.skipHws(this.fastEnd);

    let graph: RDF.Term = this.defaultGraphTerm;
    const graphStart = this.input.charCodeAt(i);
    if (graphStart === 60 || (graphStart === 95 && this.input.charCodeAt(i + 1) === 58)) {
      if (this.strictNTriples) {
        return false;
      }
      const graphTerm = this.readFastNode(i, true);
      if (!graphTerm) {
        return false;
      }
      graph = graphTerm;
      i = this.skipHws(this.fastEnd);
    }

    if (this.input.charCodeAt(i) !== 46) {
      return false;
    }
    this.index = i + 1;
    this.addQuad(subject, predicate, object, graph);
    return true;
  }

  private readFastObject(index: number): RDF.Term | null {
    const code = this.input.charCodeAt(index);
    if (code === 60) {
      if (this.input.charCodeAt(index + 1) === 60) {
        return this.relax ? this.readFastTripleTerm(index) : null;
      }
      const end = this.readFastIriEnd(index);
      if (end < 0) {
        return null;
      }
      this.fastEnd = end + 1;
      return this.factory.namedNode(this.input.slice(index + 1, end));
    }
    if (code === 95 && this.input.charCodeAt(index + 1) === 58) {
      return this.readFastBlankNode(index);
    }
    if (code === 34) {
      return this.readFastLiteral(index);
    }
    return null;
  }

  private readFastTripleTerm(index: number): RDF.Term | null {
    let i = index + 2;
    i = this.skipHws(i);
    if (this.input.charCodeAt(i) !== 40) {
      return null;
    }
    i = this.skipHws(i + 1);

    const subject = this.readFastNode(i, false);
    if (!subject) {
      return null;
    }
    i = this.skipHws(this.fastEnd);

    const predicateEnd = this.readFastIriEnd(i);
    if (predicateEnd < 0) {
      return null;
    }
    const predicate = this.cachedNamedNode(this.input.slice(i + 1, predicateEnd));
    i = this.skipHws(predicateEnd + 1);

    const object = this.readFastObject(i);
    if (!object) {
      return null;
    }
    i = this.skipHws(this.fastEnd);

    if (this.input.charCodeAt(i) !== 41 || this.input.charCodeAt(i + 1) !== 62 || this.input.charCodeAt(i + 2) !== 62) {
      return null;
    }
    this.fastEnd = i + 3;
    return this.factory.quad(subject, predicate, object, this.factory.defaultGraph());
  }

  private readFastNode(index: number, cache: boolean): RDF.Term | null {
    const code = this.input.charCodeAt(index);
    if (code === 60) {
      if (this.input.charCodeAt(index + 1) === 60) {
        return null;
      }
      const end = this.readFastIriEnd(index);
      if (end < 0) {
        return null;
      }
      this.fastEnd = end + 1;
      const value = this.input.slice(index + 1, end);
      return cache ? this.cachedNamedNode(value) : this.factory.namedNode(value);
    }
    if (code === 95 && this.input.charCodeAt(index + 1) === 58) {
      return this.readFastBlankNode(index);
    }
    return null;
  }

  private readFastBlankNode(index: number): RDF.BlankNode | null {
    let i = index + 2;
    const start = i;
    while (i < this.length) {
      const code = this.input.charCodeAt(i);
      if (!isNameChar(code)) {
        break;
      }
      if (code === 46) {
        const next = this.input.charCodeAt(i + 1);
        if (isDotTerminator(next)) {
          break;
        }
      }
      i++;
    }
    if (i === start) {
      return null;
    }
    this.fastEnd = i;
    return this.blankNodeFromLabel(this.input.slice(start, i));
  }

  private readFastLiteral(index: number): RDF.Literal | null {
    const end = this.input.indexOf('"', index + 1);
    if (end < 0) {
      return null;
    }
    for (let i = index + 1; i < end; i++) {
      const code = this.input.charCodeAt(i);
      if (code === 92 || code === 10 || code === 13) {
        return null;
      }
    }

    const value = this.input.slice(index + 1, end);
    let i = end + 1;
    const next = this.input.charCodeAt(i);
    if (next === 64) {
      const start = ++i;
      while (i < this.length) {
        const code = this.input.charCodeAt(i);
        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45) {
          i++;
        } else {
          break;
        }
      }
      if (i === start) {
        return null;
      }
      const tag = this.input.slice(start, i);
      if (!this.relax && !isLanguageTagValid(tag)) {
        return null;
      }
      this.fastEnd = i;
      return this.languageLiteral(value, tag);
    }
    if (next === 94 && this.input.charCodeAt(i + 1) === 94) {
      i += 2;
      const datatypeEnd = this.readFastIriEnd(i);
      if (datatypeEnd < 0) {
        return null;
      }
      const datatypeValue = this.input.slice(i + 1, datatypeEnd);
      if (!this.relax && (datatypeValue === RDF_LANG_STRING || datatypeValue === RDF_DIR_LANG_STRING)) {
        return null;
      }
      this.fastEnd = datatypeEnd + 1;
      return this.factory.literal(value, this.cachedNamedNode(datatypeValue));
    }
    this.fastEnd = i;
    return this.factory.literal(value);
  }

  private readFastIriEnd(index: number): number {
    if (this.input.charCodeAt(index) !== 60) {
      return -1;
    }
    const end = this.input.indexOf('>', index + 1);
    if (end < 0) {
      return -1;
    }
    if (this.relax) {
      return end;
    }

    let hasScheme = false;
    for (let i = index + 1; i < end; i++) {
      const code = this.input.charCodeAt(i);
      if (code === 58 && i > index + 1) {
        hasScheme = true;
      }
      if (code <= 32 || code === 34 || code === 60 || code === 92 || code === 94 || code === 96 ||
        code === 123 || code === 124 || code === 125) {
        return -1;
      }
    }
    return hasScheme ? end : -1;
  }

  private skipHws(index: number): number {
    while (index < this.length) {
      const code = this.input.charCodeAt(index);
      if (code !== 32 && code !== 9) {
        break;
      }
      index++;
    }
    return index;
  }

  private cachedNamedNode(value: string): RDF.NamedNode {
    const cached = this.namedNodeCache.get(value);
    if (cached) {
      return cached;
    }
    const node = this.factory.namedNode(value);
    if (this.namedNodeCache.size < 4096) {
      this.namedNodeCache.set(value, node);
    }
    return node;
  }

  private parseStatement(defaultGraph: RDF.Term, allowGraphCloseTerminator = false, insideGraphBlock = false): boolean {
    this.skipWsAndComments();
    if (this.parseDirective(defaultGraph)) {
      if (insideGraphBlock) {
        this.fail('Directives are not allowed inside graph blocks');
      }
      return false;
    }
    if (this.peekCharCode() === 123) {
      this.assertGraphBlockAllowed(insideGraphBlock);
      this.index++;
      this.parseGraphStatements(defaultGraph);
      return false;
    }
    if (this.allowGraphs && this.matchWord('GRAPH')) {
      if (insideGraphBlock) {
        this.fail('Graph blocks are not allowed inside graph blocks');
      }
      this.skipWsAndComments();
      const graph = this.parseGraphLabel(defaultGraph);
      this.skipWsAndComments();
      this.expectChar(123, 'Expected { after GRAPH label');
      this.parseGraphStatements(graph);
      return false;
    }

    const termStart = this.index;
    const subjectOrGraph = this.parseSubject(defaultGraph);
    const termEnd = this.index;
    this.skipWsAndComments();
    if (this.peekCharCode() === 123) {
      this.assertGraphBlockAllowed(insideGraphBlock);
      this.assertGraphLabel(subjectOrGraph, termStart, termEnd);
      this.index++;
      this.parseGraphStatements(subjectOrGraph);
      return false;
    }
    // `[ ... ] .` and a standalone reified triple `<< ... >> .` need no predicate-object list
    if (this.isBlankNodePropertyListSubject(termStart, termEnd) ||
      this.isReifiedTripleSubject(termStart, subjectOrGraph)) {
      if (this.peekCharCode() === 46) {
        this.index++;
        return false;
      }
      if (allowGraphCloseTerminator && this.peekCharCode() === 125) {
        return true;
      }
    }
    return this.parsePredicateObjectList(subjectOrGraph, defaultGraph, 46, allowGraphCloseTerminator);
  }

  private assertGraphBlockAllowed(insideGraphBlock: boolean): void {
    if (insideGraphBlock) {
      this.fail('Graph blocks are not allowed inside graph blocks');
    }
    if (!this.allowGraphs) {
      this.fail('Graph blocks are not allowed in this format');
    }
  }

  private parseGraphStatements(graph: RDF.Term): void {
    let lastStatementClosedByGraph = false;
    while (true) {
      this.skipWsAndComments();
      if (this.index >= this.length) {
        this.fail('Unclosed graph block');
      }
      if (this.peekCharCode() === 125) {
        this.index++;
        this.skipWsAndComments();
        if (lastStatementClosedByGraph && this.peekCharCode() === 46) {
          this.fail('Expected . after triple');
        }
        if (this.peekCharCode() === 46) {
          this.index++;
        }
        return;
      }
      lastStatementClosedByGraph = this.parseStatement(graph, this.allowDotlessGraphTerminator, true);
    }
  }

  private parsePredicateObjectList(
    subject: RDF.Term,
    graph: RDF.Term,
    terminatorCode = 46,
    allowGraphCloseTerminator = false,
  ): boolean {
    while (true) {
      const predicate = this.parsePredicate(graph);
      this.skipWsAndComments();
      while (true) {
        const object = this.parseObject(graph);
        this.skipWsAndComments();

        if (terminatorCode === 46 && !allowGraphCloseTerminator && graph.termType === 'DefaultGraph' &&
          this.canStartTerm() && !this.nextIsStatementBoundary()) {
          if (!this.allowQuadStatements) {
            this.fail(`Graph terms are not allowed in ${this.strictNTriples ? 'N-Triples' : 'this format'}`);
          }
          const explicitGraph = this.parseNamedOrBlankTerm(graph);
          this.addQuad(subject, predicate, object, explicitGraph);
          this.skipWsAndComments();
          this.expectChar(46, 'Expected . after quad');
          return false;
        }

        this.addQuad(subject, predicate, object, graph);
        this.parseAnnotations(subject, predicate, object, graph);
        if (this.peekCharCode() !== 44) {
          break;
        }
        if (this.strictLineFormat) {
          this.fail('Object lists are not allowed in this format');
        }
        this.index++;
        this.skipWsAndComments();
      }

      if (this.peekCharCode() !== 59) {
        break;
      }
      if (this.strictLineFormat) {
        this.fail('Predicate lists are not allowed in this format');
      }
      do {
        this.index++;
        this.skipWsAndComments();
      } while (this.peekCharCode() === 59);
      if (this.peekCharCode() === terminatorCode || (allowGraphCloseTerminator && this.peekCharCode() === 125)) {
        break;
      }
    }
    if (allowGraphCloseTerminator && this.peekCharCode() === 125) {
      return true;
    }
    if (terminatorCode === 46) {
      this.expectChar(46, 'Expected . after triple');
    } else if (this.peekCharCode() !== terminatorCode) {
      this.fail(`Expected ${String.fromCharCode(terminatorCode)} after property list`);
    }
    return false;
  }

  /**
   * Parses the RDF 1.2 annotations following an object: reifiers (`~ reifier`) and annotation blocks
   * (`{| predicateObjectList |}`). An annotation block describes the reifier directly before it, or a fresh
   * blank node reifier when there is none.
   */
  private parseAnnotations(subject: RDF.Term, predicate: RDF.Term, object: RDF.Term, graph: RDF.Term): void {
    let tripleTerm: RDF.BaseQuad | undefined;
    let reifier: RDF.Term | undefined;
    while (true) {
      const code = this.peekCharCode();
      const annotationBlock = code === 123 && this.input.charCodeAt(this.index + 1) === 124;
      if (code !== 126 && !annotationBlock) {
        return;
      }
      if (this.strictLineFormat) {
        this.fail('Annotations are not allowed in this format');
      }
      tripleTerm ??= this.factory.quad(subject, predicate, object, this.factory.defaultGraph());
      if (annotationBlock) {
        this.index += 2;
        this.skipWsAndComments();
        if (!reifier) {
          reifier = this.createFreshBlankNode();
          this.addQuad(reifier, this.factory.namedNode(RDF_REIFIES), tripleTerm, graph);
        }
        this.parsePredicateObjectList(reifier, graph, 124);
        if (this.input.charCodeAt(this.index + 1) !== 125) {
          this.fail('Expected |} after annotation block');
        }
        this.index += 2;
        reifier = undefined;
      } else {
        this.index++;
        reifier = this.parseOptionalReifier(graph);
        this.addQuad(reifier, this.factory.namedNode(RDF_REIFIES), tripleTerm, graph);
      }
      this.skipWsAndComments();
    }
  }

  private addQuad(subject: RDF.Term, predicate: RDF.Term, object: RDF.Term, graph: RDF.Term): void {
    const quad = this.factory.quad(subject, predicate, object, graph);
    this.quads.push(quad);
    if (this.messagesEnabled) {
      this.messageQuads.push({ quad, messageCounter: this.messageCounter });
      this.messageCountHint = Math.max(this.messageCountHint, this.messageCounter + 1);
      this.afterMessageDelimiter = false;
    }
  }

  private parseDirective(currentGraph: RDF.Term): boolean {
    const start = this.index;
    if (this.peekCharCode() === 64) {
      if (this.strictLineFormat) {
        this.fail('Directives are not allowed in this format');
      }
      // The keyword is a token of its own, so `@prefix:<...>` is a directive too
      let end = start + 1;
      while (isAsciiLetter(this.input.charCodeAt(end))) {
        end++;
      }
      const keyword = this.input.slice(start + 1, end);
      if (keyword !== 'version' && keyword !== 'prefix' && keyword !== 'base' && keyword !== 'message') {
        return false;
      }
      this.index = end;
      if (keyword === 'version') {
        this.parseVersionDirective(true);
      } else if (keyword === 'prefix') {
        this.parsePrefixDirective(true);
      } else if (keyword === 'base') {
        this.parseBaseDirective(true);
      } else {
        this.parseMessageDirective(true, currentGraph);
      }
      return true;
    }
    if (this.matchWord('VERSION')) {
      this.parseVersionDirective(false);
      return true;
    }
    if (this.matchWord('MESSAGE')) {
      this.parseMessageDirective(false, currentGraph);
      return true;
    }
    if (this.matchWord('PREFIX')) {
      if (this.strictLineFormat) {
        this.fail('Directives are not allowed in this format');
      }
      this.parsePrefixDirective(false);
      return true;
    }
    if (this.matchWord('BASE')) {
      if (this.strictLineFormat) {
        this.fail('Directives are not allowed in this format');
      }
      this.parseBaseDirective(false);
      return true;
    }
    return false;
  }

  private parseVersionDirective(needsDot: boolean): void {
    this.skipWsAndComments();
    const quote = this.peekCharCode();
    if (quote !== 34 && quote !== 39) {
      this.fail('Expected a version string');
    }
    if (this.input.charCodeAt(this.index + 1) === quote && this.input.charCodeAt(this.index + 2) === quote) {
      this.fail('Version labels must not use long strings');
    }
    this.version = this.readQuotedString();
    if (!this.parseUnsupportedVersions && !SUPPORTED_VERSIONS.has(this.version) && !isMessagesVersion(this.version)) {
      this.fail(`Unsupported version "${this.version}"`);
    }
    if (isMessagesVersion(this.version)) {
      this.messagesEnabled = true;
    }
    this.skipWsAndComments();
    if (needsDot) {
      this.expectChar(46, 'Expected . after version directive');
    }
  }

  private parseMessageDirective(needsDot: boolean, currentGraph: RDF.Term): void {
    if (!this.messagesEnabled) {
      this.fail('RDF Messages are not enabled');
    }
    if (currentGraph.termType !== 'DefaultGraph') {
      this.fail('Message delimiters are not allowed inside graph blocks');
    }
    this.skipWsAndComments();
    if (needsDot) {
      this.expectChar(46, 'Expected . after message directive');
    }
    this.finishMessage();
  }

  private parsePrefixDirective(needsDot: boolean): void {
    this.skipWsAndComments();
    const prefix = this.readName(NAME_PREFIX);
    this.expectChar(58, 'Expected : after prefix label');
    this.skipWsAndComments();
    const iri = this.parseIri();
    this.prefixes[prefix] = iri;
    this.callbacks.prefix?.(prefix, iri);
    this.skipWsAndComments();
    if (needsDot) {
      this.expectChar(46, 'Expected . after prefix directive');
    }
  }

  private parseBaseDirective(needsDot: boolean): void {
    this.skipWsAndComments();
    this.baseIRI = this.parseIri().value;
    this.skipWsAndComments();
    if (needsDot) {
      this.expectChar(46, 'Expected . after base directive');
    }
  }

  private parseSubject(graph: RDF.Term): RDF.Term {
    const term = this.parseTerm(graph);
    if (term.termType === 'Literal' || term.termType === 'Quad') {
      this.fail(`Invalid subject term ${term.termType}`);
    }
    return term;
  }

  private parseObject(graph: RDF.Term): RDF.Term {
    return this.parseTerm(graph);
  }

  private parsePredicate(graph: RDF.Term): RDF.Term {
    if (this.matchWord('a', false, true)) {
      return this.factory.namedNode(RDF_TYPE);
    }
    const term = this.parseTerm(graph);
    if (term.termType !== 'NamedNode') {
      this.fail(`Invalid predicate term ${term.termType}`);
    }
    return term;
  }

  private parseNamedOrBlankTerm(graph: RDF.Term): RDF.Term {
    const term = this.parseTerm(graph);
    if (term.termType !== 'NamedNode' && term.termType !== 'BlankNode') {
      this.fail(`Invalid graph term ${term.termType}`);
    }
    return term;
  }

  private parseGraphLabel(graph: RDF.Term): RDF.Term {
    const start = this.index;
    const term = this.parseNamedOrBlankTerm(graph);
    this.assertGraphLabel(term, start);
    return term;
  }

  /** Rejects graph labels that are syntactically not an IRI or blank node label, such as `[ <p> <o> ]` or `( )`. */
  private assertGraphLabel(term: RDF.Term, start: number, end = this.index): void {
    const code = this.input.charCodeAt(start);
    if ((code === 91 && !this.isAnonymousBlankNodeLabel(start, end)) || code === 40 ||
      (code === 60 && this.input.charCodeAt(start + 1) === 60)) {
      this.fail(`Invalid graph term ${term.termType}`);
    }
  }

  /** Whether the term in `[start, end)` is `[]`, possibly with whitespace and comments between the brackets. */
  private isAnonymousBlankNodeLabel(start: number, end: number): boolean {
    return this.input.charCodeAt(start) === 91 && this.input.charCodeAt(end - 1) === 93 &&
      scanTrailingTriviaEnd(this.input, start + 1) === end - 1;
  }

  private isReifiedTripleSubject(start: number, term: RDF.Term): boolean {
    return term.termType !== 'Quad' && this.input.charCodeAt(start) === 60 && this.input.charCodeAt(start + 1) === 60;
  }

  private isBlankNodePropertyListSubject(start: number, end: number): boolean {
    return this.input.charCodeAt(start) === 91 && !this.isAnonymousBlankNodeLabel(start, end);
  }

  private parseTerm(graph: RDF.Term): RDF.Term {
    this.skipWsAndComments();
    const code = this.peekCharCode();
    if (code < 0) {
      this.fail('Unexpected end of input');
    }

    if (code === 60) {
      if (this.input.charCodeAt(this.index + 1) === 60) {
        return this.parseDoubleAngleTerm(graph);
      }
      return this.parseIri();
    }
    if (code === 34 || code === 39) {
      return this.parseLiteral();
    }
    if (code === 95 && this.input.charCodeAt(this.index + 1) === 58) {
      return this.parseBlankNode();
    }
    if (code === 91) {
      return this.parseBlankNodePropertyList(graph);
    }
    if (code === 40) {
      return this.parseCollection(graph);
    }
    const next = this.input.charCodeAt(this.index + 1);
    if (code === 43 || code === 45 || (code >= 48 && code <= 57) || (code === 46 && next >= 48 && next <= 57)) {
      return this.parseNumber();
    }
    if (this.strictLineFormat && (this.matchWord('true', true, true) || this.matchWord('false', true, true))) {
      this.fail('Boolean literals are not allowed in this format');
    }
    if (this.matchWord('true', true, true)) {
      return this.factory.literal('true', this.factory.namedNode(XSD_BOOLEAN));
    }
    if (this.matchWord('false', true, true)) {
      return this.factory.literal('false', this.factory.namedNode(XSD_BOOLEAN));
    }
    return this.parsePrefixedName();
  }

  private parseDoubleAngleTerm(graph: RDF.Term): RDF.Term {
    this.index += 2;
    this.skipWsAndComments();
    if (this.peekCharCode() === 40) {
      return this.parseTripleTerm(graph);
    }
    if (this.strictLineFormat) {
      this.fail('Reified triples are not allowed in this format');
    }
    return this.parseReifiedTriple(graph);
  }

  private parseTripleTerm(graph: RDF.Term): RDF.Term {
    this.expectChar(40, 'Expected ( after << in RDF1.2 triple term');
    const subject = this.parseSubject(graph);
    const predicate = this.parsePredicate(graph);
    const object = this.parseObject(graph);
    this.skipWsAndComments();
    this.expectChar(41, 'Expected ) after triple term');
    this.skipWsAndComments();
    if (this.input.charCodeAt(this.index) !== 62 || this.input.charCodeAt(this.index + 1) !== 62) {
      this.fail('Expected >> after triple term');
    }
    this.index += 2;
    return this.factory.quad(subject, predicate, object, this.factory.defaultGraph());
  }

  private parseReifiedTriple(graph: RDF.Term): RDF.Term {
    const subject = this.parseReifiedTripleSubject(graph);
    const predicate = this.parsePredicate(graph);
    const object = this.parseReifiedTripleObject(graph);
    this.skipWsAndComments();
    const reifier = this.peekCharCode() === 126 ? this.parseReifier(graph) : this.createFreshBlankNode();
    this.skipWsAndComments();
    if (this.input.charCodeAt(this.index) !== 62 || this.input.charCodeAt(this.index + 1) !== 62) {
      this.fail('Expected >> after reified triple');
    }
    this.index += 2;
    const tripleTerm = this.factory.quad(subject, predicate, object, this.factory.defaultGraph());
    this.addQuad(reifier, this.factory.namedNode(RDF_REIFIES), tripleTerm, graph);
    return reifier;
  }

  private parseReifiedTripleSubject(graph: RDF.Term): RDF.Term {
    this.skipWsAndComments();
    const start = this.index;
    const term = this.parseTerm(graph);
    this.assertReifiedTripleTerm(term, start, 'subject');
    if (term.termType === 'Literal' || term.termType === 'Quad') {
      this.fail(`Invalid reified triple subject term ${term.termType}`);
    }
    return term;
  }

  private parseReifiedTripleObject(graph: RDF.Term): RDF.Term {
    this.skipWsAndComments();
    const start = this.index;
    const term = this.parseTerm(graph);
    this.assertReifiedTripleTerm(term, start, 'object');
    return term;
  }

  private parseReifier(graph: RDF.Term): RDF.Term {
    this.index++;
    return this.parseOptionalReifier(graph);
  }

  /** Parses the IRI or blank node after `~`, or creates a fresh blank node when it is omitted. */
  private parseOptionalReifier(graph: RDF.Term): RDF.Term {
    this.skipWsAndComments();
    const code = this.peekCharCode();
    if (!(code === 91 || isPrefixStart(code) || (code === 60 && this.input.charCodeAt(this.index + 1) !== 60))) {
      return this.createFreshBlankNode();
    }
    const start = this.index;
    const term = this.parseTerm(graph);
    this.assertReifiedTripleTerm(term, start, 'reifier');
    if (term.termType !== 'NamedNode' && term.termType !== 'BlankNode') {
      this.fail(`Invalid reifier term ${term.termType}`);
    }
    return term;
  }

  private assertReifiedTripleTerm(term: RDF.Term, start: number, position: string, end = this.index): void {
    const code = this.input.charCodeAt(start);
    if (code === 40 || (code === 91 && !this.isAnonymousBlankNodeLabel(start, end))) {
      this.fail(`Invalid reified triple ${position} term ${term.termType}`);
    }
  }

  private parseIri(): RDF.NamedNode {
    this.expectChar(60, 'Expected <');
    let value = '';
    while (this.index < this.length) {
      const code = this.peekCharCode();
      if (code === 62) {
        this.index++;
        if (!hasScheme(value)) {
          if (this.strictLineFormat) {
            this.fail('Relative IRIs are not allowed in this format');
          }
          if (hasColonInFirstSegment(value)) {
            this.fail('Invalid relative IRI: colon in first path segment');
          }
        }
        return this.factory.namedNode(resolveIri(value, this.baseIRI));
      }
      if (code === 92) {
        this.index++;
        const escapeCode = this.peekCharCode();
        if (this.strictLineFormat && escapeCode !== 117 && escapeCode !== 85) {
          this.fail('Only Unicode escapes are allowed in IRIs');
        }
        const escaped = this.readEscape();
        if (isInvalidIriChar(escaped.codePointAt(0)!)) {
          this.fail('Invalid character in IRI');
        }
        value += escaped;
        continue;
      }
      if (isInvalidIriChar(code)) {
        this.fail('Invalid character in IRI');
      }
      value += this.input[this.index]!;
      this.advanceOne();
    }
    this.fail('Unterminated IRI');
  }

  private parseLiteral(): RDF.Literal {
    if (this.strictLineFormat && this.peekCharCode() !== 34) {
      this.fail('Only double-quoted literals are allowed in this format');
    }
    const value = this.readQuotedString();
    if (this.peekCharCode() === 64) {
      this.index++;
      const tag = this.readLanguageTag();
      return this.languageLiteral(value, tag);
    }
    if (this.peekCharCode() === 94 && this.input.charCodeAt(this.index + 1) === 94) {
      this.index += 2;
      const datatype = this.parseTerm(this.factory.defaultGraph());
      if (datatype.termType !== 'NamedNode') {
        this.fail('Expected datatype IRI after ^^');
      }
      if (datatype.value === RDF_LANG_STRING || datatype.value === RDF_DIR_LANG_STRING) {
        this.fail('Language string datatypes require an explicit language tag');
      }
      return this.factory.literal(value, datatype);
    }
    return this.factory.literal(value);
  }

  /** Creates a literal from a language tag, which may carry an RDF 1.2 base direction (`en--ltr`). */
  private languageLiteral(value: string, tag: string): RDF.Literal {
    const directionalSeparator = tag.indexOf('--');
    if (directionalSeparator < 0) {
      return this.factory.literal(value, tag.toLowerCase());
    }
    return this.factory.literal(value, {
      language: tag.slice(0, directionalSeparator).toLowerCase(),
      direction: <LiteralDirection>tag.slice(directionalSeparator + 2).toLowerCase(),
    });
  }

  private parseBlankNode(): RDF.BlankNode {
    this.index += 2;
    const label = this.readName(NAME_BLANK_NODE_LABEL);
    if (!label) {
      this.fail('Expected blank node label');
    }
    return this.blankNodeFromLabel(label);
  }

  private parseBlankNodePropertyList(graph: RDF.Term): RDF.BlankNode {
    this.expectChar(91, 'Expected [');
    const blank = this.createBlankNode(`b${this.localBlankNodeCounter++}`);
    this.skipWsAndComments();
    if (this.peekCharCode() === 93) {
      this.index++;
      return blank;
    }
    this.parsePredicateObjectList(blank, graph, 93);
    this.skipWsAndComments();
    this.expectChar(93, 'Expected ] after blank node property list');
    return blank;
  }

  private parseCollection(graph: RDF.Term): RDF.Term {
    this.expectChar(40, 'Expected (');
    this.skipWsAndComments();
    if (this.peekCharCode() === 41) {
      this.index++;
      return this.factory.namedNode(RDF_NIL);
    }

    const head = this.createBlankNode(`b${this.localBlankNodeCounter++}`);
    let current = head;
    while (true) {
      const item = this.parseObject(graph);
      this.addQuad(current, this.factory.namedNode(RDF_FIRST), item, graph);
      this.skipWsAndComments();
      if (this.peekCharCode() === 41) {
        this.index++;
        this.addQuad(current, this.factory.namedNode(RDF_REST), this.factory.namedNode(RDF_NIL), graph);
        return head;
      }
      const next = this.createBlankNode(`b${this.localBlankNodeCounter++}`);
      this.addQuad(current, this.factory.namedNode(RDF_REST), next, graph);
      current = next;
    }
  }

  private blankNodeFromLabel(label: string): RDF.BlankNode {
    if (!this.messagesEnabled) {
      return this.factory.blankNode(label);
    }
    const existing = this.blankNodeLabels.get(label);
    if (existing) {
      return existing;
    }
    const blank = this.createBlankNode(label);
    this.blankNodeLabels.set(label, blank);
    return blank;
  }

  private createBlankNode(label: string): RDF.BlankNode {
    return this.messagesEnabled ? this.factory.blankNode(`m${this.messageCounter}_${label}`) : this.factory.blankNode(label);
  }

  private createFreshBlankNode(): RDF.BlankNode {
    return this.createBlankNode(`b${this.localBlankNodeCounter++}`);
  }

  private finishMessage(): void {
    this.messageCountHint = Math.max(this.messageCountHint, this.messageCounter + 1);
    this.messageCounter++;
    this.afterMessageDelimiter = true;
    this.blankNodeLabels.clear();
    this.localBlankNodeCounter = 0;
  }

  private finalizeEndOfFileMessage(): void {
    if (!this.messagesEnabled) {
      return;
    }
    if (!this.afterMessageDelimiter) {
      this.messageCountHint = Math.max(this.messageCountHint, this.messageCounter + 1);
    }
    this.messageQuads.messageCount = this.messageCountHint;
  }

  private parseNumber(): RDF.Literal {
    if (this.strictLineFormat) {
      this.fail('Numeric literals are not allowed in this format');
    }
    const rest = this.input.slice(this.index);
    const match = /^[+-]?(?:(?:\d+\.\d*|\.\d+|\d+)[Ee][+-]?\d+|(?:\d*\.\d+)|\d+)/u.exec(rest);
    if (!match?.[0]) {
      this.fail('Invalid number');
    }
    const value = match[0];
    this.index += value.length;
    let datatype = XSD_INTEGER;
    if (/[Ee]/u.test(value)) {
      datatype = XSD_DOUBLE;
    } else if (value.includes('.')) {
      datatype = XSD_DECIMAL;
    }
    return this.factory.literal(value, this.factory.namedNode(datatype));
  }

  private parsePrefixedName(): RDF.NamedNode {
    const prefix = this.readName(NAME_PREFIX);
    this.expectChar(58, 'Expected prefixed name');
    const local = this.readName(NAME_LOCAL);
    const namespace = this.prefixes[prefix];
    if (!namespace) {
      this.fail(`Unknown prefix "${prefix}"`);
    }
    return this.factory.namedNode(namespace.value + local);
  }

  private readQuotedString(): string {
    const quote = this.peekCharCode();
    const triple = this.input.charCodeAt(this.index + 1) === quote && this.input.charCodeAt(this.index + 2) === quote;
    if (this.strictLineFormat && triple) {
      this.fail('Long literals are not allowed in this format');
    }
    this.index += triple ? 3 : 1;
    let value = '';
    while (this.index < this.length) {
      const code = this.peekCharCode();
      if (code === quote) {
        if (triple) {
          if (this.input.charCodeAt(this.index + 1) === quote && this.input.charCodeAt(this.index + 2) === quote) {
            this.index += 3;
            return value;
          }
        } else {
          this.index++;
          return value;
        }
      }
      if (code === 92) {
        this.index++;
        value += this.readEscape();
        continue;
      }
      if (!triple && (code === 10 || code === 13)) {
        this.fail('Line breaks are not allowed in literals');
      }
      value += this.input[this.index]!;
      this.advanceOne();
    }
    this.fail('Unterminated literal');
  }

  private readEscape(): string {
    const code = this.peekCharCode();
    if (code === 116) {
      this.index++;
      return '\t';
    }
    if (code === 98) {
      this.index++;
      return '\b';
    }
    if (code === 110) {
      this.index++;
      return '\n';
    }
    if (code === 114) {
      this.index++;
      return '\r';
    }
    if (code === 102) {
      this.index++;
      return '\f';
    }
    if (code === 34 || code === 39 || code === 92) {
      this.index++;
      return String.fromCharCode(code);
    }
    if (code === 117 || code === 85) {
      const size = code === 117 ? 4 : 8;
      this.index++;
      const hex = this.input.slice(this.index, this.index + size);
      if (!/^[\dA-Fa-f]+$/u.test(hex) || hex.length !== size) {
        this.fail('Invalid Unicode escape');
      }
      this.index += size;
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint >= 0xD800 && codePoint <= 0xDFFF) {
        this.fail('Unicode escapes must not encode surrogates');
      }
      return String.fromCodePoint(codePoint);
    }
    this.fail('Invalid escape sequence');
  }

  private readLanguageTag(): string {
    const start = this.index;
    const first = this.peekCharCode();
    if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) {
      this.fail('Expected language tag');
    }
    while (this.index < this.length) {
      const code = this.peekCharCode();
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45) {
        this.index++;
      } else {
        break;
      }
    }
    const tag = this.input.slice(start, this.index);
    const directionalSeparator = tag.indexOf('--');
    const language = directionalSeparator >= 0 ? tag.slice(0, directionalSeparator) : tag;
    const direction = directionalSeparator >= 0 ? tag.slice(directionalSeparator + 2) : '';
    for (const subtag of language.split('-')) {
      if (!subtag || subtag.length > 8) {
        this.fail('Invalid language tag');
      }
    }
    if (directionalSeparator >= 0 && direction !== 'ltr' && direction !== 'rtl') {
      this.fail('Invalid base direction');
    }
    return tag.toLowerCase();
  }

  /**
   * Reads a PN_PREFIX, PN_LOCAL or BLANK_NODE_LABEL (without `_:`) and returns its value, with PN_LOCAL_ESC
   * escapes resolved. Names cannot end with `.`, so a trailing dot is left for the statement terminator.
   */
  private readName(kind: number): string {
    let i = this.index;
    let value = '';
    let end = i;
    let endValue = '';
    while (i < this.length) {
      const code = this.input.charCodeAt(i);
      if (kind === NAME_LOCAL && (code === 92 || code === 37)) {
        const escape = code === 92 ? this.input.slice(i, i + 2) : this.input.slice(i, i + 3);
        if (code === 92 ? !LOCAL_NAME_ESCAPES.has(escape.charAt(1)) : !/^%[\dA-Fa-f]{2}$/u.test(escape)) {
          this.index = i;
          this.fail(`Invalid ${code === 92 ? 'escape' : 'percent-encoding'} in local name`);
        }
        value += code === 92 ? escape.charAt(1) : escape;
        i += escape.length;
        end = i;
        endValue = value;
        continue;
      }
      const codePoint = code >= 0xD800 && code <= 0xDBFF ? this.input.codePointAt(i)! : code;
      if (!(i === this.index ? isNameStart(codePoint, kind) : isNamePart(codePoint, kind))) {
        break;
      }
      const width = codePoint > 0xFFFF ? 2 : 1;
      value += this.input.slice(i, i + width);
      i += width;
      if (code !== 46) {
        end = i;
        endValue = value;
      }
    }
    this.index = end;
    return endValue;
  }

  private skipWsAndComments(): void {
    while (this.index < this.length) {
      const code = this.peekCharCode();
      if (isWs(code)) {
        this.advanceOne();
        continue;
      }
      if (code === 35) {
        this.index++;
        const start = this.index;
        while (this.index < this.length) {
          const next = this.peekCharCode();
          if (next === 10 || next === 13) {
            break;
          }
          this.index++;
        }
        this.callbacks.comment?.(this.input.slice(start, this.index));
        continue;
      }
      return;
    }
  }

  private matchWord(word: string, allowDotBoundary = false, caseSensitive = false): boolean {
    if (this.input.length - this.index < word.length) {
      return false;
    }
    const candidate = this.input.slice(this.index, this.index + word.length);
    if (caseSensitive ? candidate !== word : candidate.toLowerCase() !== word.toLowerCase()) {
      return false;
    }
    const previous = this.index > 0 ? this.input.charCodeAt(this.index - 1) : -1;
    const next = this.input.charCodeAt(this.index + word.length);
    if ((previous >= 0 && isWordBoundaryBlocker(previous)) ||
      (isWordBoundaryBlocker(next) && !(allowDotBoundary && next === 46))) {
      return false;
    }
    this.index += word.length;
    return true;
  }

  private canStartTerm(): boolean {
    const code = this.peekCharCode();
    return code === 60 || code === 95 || code === 91 || code === 40 || code === 34 || code === 39 ||
      code === 43 || code === 45 ||
      (code >= 48 && code <= 57) || isPrefixStart(code);
  }

  private nextIsStatementBoundary(): boolean {
    const code = this.peekCharCode();
    return code === 46 || code === 59 || code === 44 || code === 125 || code === 93 || code === 41 || code < 0;
  }

  private expectChar(code: number, message: string): void {
    this.skipWsAndComments();
    if (this.peekCharCode() !== code) {
      this.fail(message);
    }
    this.index++;
  }

  private peekCharCode(): number {
    return this.index < this.length ? this.input.charCodeAt(this.index) : -1;
  }

  private advanceOne(): void {
    if (this.input.charCodeAt(this.index) === 10) {
      this.line++;
    }
    this.index++;
  }

  private fail(message: string): never {
    const error = new Error(`${message} on line ${this.line}.`);
    (<Error & { context?: unknown }>error).context = { line: this.line, index: this.index };
    throw error;
  }
}

const SUPPORTED_VERSIONS = new Set([ '1.1', '1.2', '1.2-basic' ]);

function hasScheme(iri: string): boolean {
  return /^[A-Za-z][\d+.A-Za-z-]*:/u.test(iri);
}

/** RFC 3986 section 4.2: a relative reference cannot have a colon in its first path segment. */
function hasColonInFirstSegment(iri: string): boolean {
  const colon = iri.indexOf(':');
  if (colon < 0) {
    return false;
  }
  const end = iri.search(/[#/?]/u);
  return end < 0 || colon < end;
}

interface ParsedBase {
  iri: string;
  /** `scheme:` plus `//authority` when present */
  prefix: string;
  hasAuthority: boolean;
  path: string;
  /** Including the leading `?`, or empty */
  query: string;
}

let lastBase: ParsedBase | undefined;

function parseBase(iri: string): ParsedBase | undefined {
  if (lastBase?.iri === iri) {
    return lastBase;
  }
  const match = /^([A-Za-z][\d+.A-Za-z-]*:)(\/\/[^#/?]*)?([^#?]*)(\?[^#]*)?/u.exec(iri);
  if (!match) {
    return undefined;
  }
  lastBase = {
    iri,
    prefix: match[1]! + (match[2] ?? ''),
    hasAuthority: match[2] !== undefined,
    path: match[3]!,
    query: match[4] ?? '',
  };
  return lastBase;
}

/**
 * Resolves the IRI reference `value` against `baseIRI` with the algorithm of RFC 3986 section 5.2.
 * Absolute IRIs are returned as written (as other RDF parsers do), and no other normalization is applied.
 * The WHATWG `URL` class is not used because it normalizes (lowercasing hosts, percent-encoding non-ASCII
 * characters, adding trailing slashes) and rejects non-hierarchical bases.
 */
function resolveIri(value: string, baseIRI: string): string {
  if (!baseIRI || hasScheme(value)) {
    return value;
  }
  const base = parseBase(baseIRI);
  if (!base) {
    return value;
  }
  const first = value.charCodeAt(0);
  // Network-path reference: only the scheme is inherited
  if (first === 47 && value.charCodeAt(1) === 47) {
    const authorityEnd = value.slice(2).search(/[#/?]/u);
    if (authorityEnd < 0) {
      return base.prefix.slice(0, base.prefix.indexOf(':') + 1) + value;
    }
    const pathStart = authorityEnd + 2;
    return base.prefix.slice(0, base.prefix.indexOf(':') + 1) + value.slice(0, pathStart) +
      removeDotSegmentsOfReference(value.slice(pathStart));
  }
  // Empty path: inherit the base path, and the base query unless the reference has one
  if (Number.isNaN(first) || first === 35) {
    return base.prefix + base.path + base.query + value;
  }
  if (first === 63) {
    return base.prefix + base.path + value;
  }
  if (first === 47) {
    return base.prefix + removeDotSegmentsOfReference(value);
  }
  // Merge the reference with the base path (RFC 3986 section 5.2.3)
  const directory = base.hasAuthority && base.path === '' ? '/' : base.path.slice(0, base.path.lastIndexOf('/') + 1);
  return base.prefix + removeDotSegmentsOfReference(directory + value);
}

/** Removes the dot segments of the path part of `reference`, leaving its query and fragment untouched. */
function removeDotSegmentsOfReference(reference: string): string {
  const pathEnd = reference.search(/[#?]/u);
  if (pathEnd < 0) {
    return removeDotSegments(reference);
  }
  return removeDotSegments(reference.slice(0, pathEnd)) + reference.slice(pathEnd);
}

/** RFC 3986 section 5.2.4 */
function removeDotSegments(path: string): string {
  if (!path.includes('.')) {
    return path;
  }
  let input = path;
  let output = '';
  while (input.length > 0) {
    if (input.startsWith('../')) {
      input = input.slice(3);
    } else if (input.startsWith('./') || input.startsWith('/./')) {
      input = input.slice(2);
    } else if (input === '/.') {
      input = '/';
    } else if (input.startsWith('/../') || input === '/..') {
      input = input === '/..' ? '/' : input.slice(3);
      output = output.slice(0, Math.max(0, output.lastIndexOf('/')));
    } else if (input === '.' || input === '..') {
      input = '';
    } else {
      const segmentEnd = input.indexOf('/', 1);
      const segment = segmentEnd < 0 ? input : input.slice(0, segmentEnd);
      output += segment;
      input = input.slice(segment.length);
    }
  }
  return output;
}

function isMessagesVersion(version: string | undefined): boolean {
  return typeof version === 'string' && version.toLowerCase().endsWith('-messages');
}

/** Whether the character following a `.` makes that dot a terminator rather than part of a name. */
function isDotTerminator(next: number): boolean {
  return Number.isNaN(next) || isWs(next) || next === 59 || next === 44 || next === 125 || next === 93 || next === 41;
}

function isWs(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function isInvalidIriChar(code: number): boolean {
  return code <= 32 || code === 34 || code === 60 || code === 62 || code === 94 || code === 96 ||
    code === 123 || code === 124 || code === 125;
}

function isNameChar(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) ||
    code === 95 || code === 45 || code === 46;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isWordBoundaryBlocker(code: number): boolean {
  return isNameChar(code) || code === 58 || code >= 0x80;
}

/** Whether `code` can start a prefixed name; non-ASCII candidates are validated by readName. */
function isPrefixStart(code: number): boolean {
  return code === 58 || code === 95 || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code >= 0x80;
}

const NAME_PREFIX = 0;
const NAME_LOCAL = 1;
const NAME_BLANK_NODE_LABEL = 2;
const LOCAL_NAME_ESCAPES = new Set('_~.-!$&\'()*+,;=/?#@%');

/** PN_CHARS_BASE */
function isPnCharsBase(cp: number): boolean {
  return (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || (cp >= 0xC0 && cp <= 0xD6) ||
    (cp >= 0xD8 && cp <= 0xF6) || (cp >= 0xF8 && cp <= 0x2FF) || (cp >= 0x370 && cp <= 0x37D) ||
    (cp >= 0x37F && cp <= 0x1FFF) || cp === 0x200C || cp === 0x200D || (cp >= 0x2070 && cp <= 0x218F) ||
    (cp >= 0x2C00 && cp <= 0x2FEF) || (cp >= 0x3001 && cp <= 0xD7FF) || (cp >= 0xF900 && cp <= 0xFDCF) ||
    (cp >= 0xFDF0 && cp <= 0xFFFD) || (cp >= 0x10000 && cp <= 0xEFFFF);
}

/** PN_CHARS */
function isPnChars(cp: number): boolean {
  return cp === 95 || cp === 45 || (cp >= 48 && cp <= 57) || isPnCharsBase(cp) || cp === 0xB7 ||
    (cp >= 0x300 && cp <= 0x36F) || cp === 0x203F || cp === 0x2040;
}

/** The first character of PN_PREFIX, PN_LOCAL (escapes aside) and BLANK_NODE_LABEL */
function isNameStart(cp: number, kind: number): boolean {
  if (kind === NAME_PREFIX) {
    return isPnCharsBase(cp);
  }
  return cp === 95 || (cp >= 48 && cp <= 57) || isPnCharsBase(cp) || (kind === NAME_LOCAL && cp === 58);
}

/** Later characters of a name; a trailing `.` is removed by readName */
function isNamePart(cp: number, kind: number): boolean {
  return cp === 46 || isPnChars(cp) || (kind === NAME_LOCAL && cp === 58);
}

function isLanguageTagValid(tag: string): boolean {
  const directionalSeparator = tag.indexOf('--');
  const language = directionalSeparator >= 0 ? tag.slice(0, directionalSeparator) : tag;
  const direction = directionalSeparator >= 0 ? tag.slice(directionalSeparator + 2) : '';
  const first = language.charCodeAt(0);
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) {
    return false;
  }
  for (const subtag of language.split('-')) {
    if (!subtag || subtag.length > 8) {
      return false;
    }
  }
  return directionalSeparator < 0 || direction === 'ltr' || direction === 'rtl';
}

/** Type guard for the `{ quad, messageCounter }` entries emitted in RDF Messages mode. */
export function isMessageQuad(value: unknown): value is MessageQuad {
  return Boolean(value && typeof value === 'object' && 'quad' in value && 'messageCounter' in value);
}

/**
 * Groups parser output into one {@link Message} per RDF Message, preserving empty messages.
 * Plain quads are all assigned to message 0.
 */
export function toMessages(output: Iterable<ParserOutputItem>, messageCount?: number): Message[] {
  const messages: Message[] = [];
  const parsedMessageCount = messageCount ?? getMessageCount(output);

  for (const item of output) {
    const entry = isMessageQuad(item) ? item : { quad: item, messageCounter: 0 };
    while (messages.length <= entry.messageCounter) {
      messages.push(new Message(messages.length));
    }
    messages[entry.messageCounter]!.push(entry.quad);
  }

  if (parsedMessageCount !== undefined) {
    while (messages.length < parsedMessageCount) {
      messages.push(new Message(messages.length));
    }
  }

  return messages;
}

function getMessageCount(output: Iterable<ParserOutputItem>): number | undefined {
  if (!Array.isArray(output) || !('messageCount' in output)) {
    return undefined;
  }
  const value = (<Partial<MessageQuadArray>>output).messageCount;
  return typeof value === 'number' ? value : undefined;
}

export const namedNode = DataFactory.namedNode;
export const blankNode = DataFactory.blankNode;
export const literal = DataFactory.literal;
export const variable = DataFactory.variable;
export const defaultGraph = DataFactory.defaultGraph;
export const quad = DataFactory.quad;
