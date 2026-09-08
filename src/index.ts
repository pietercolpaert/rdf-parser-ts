import { Transform, type TransformCallback, type TransformOptions, type Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type * as RDFJS from '@rdfjs/types';

export type TermType = RDFJS.Term['termType'];
export type Term = RDFJS.Term;

export interface ParserOptions {
  baseIRI?: string;
  baseIRIPath?: string;
  format?: string;
  factory?: DataFactoryLike;
  comments?: boolean;
  relax?: boolean;
  rdfMessages?: boolean;
  messages?: boolean;
  parseUnsupportedVersions?: boolean;
  version?: string;
}

export interface StreamParserOptions extends ParserOptions, TransformOptions {}

export interface DataFactoryLike {
  namedNode(value: string): NamedNodeLike;
  blankNode(value?: string): BlankNodeLike;
  literal(value: string, languageOrDatatype?: string | NamedNodeLike | RDFJS.DirectionalLanguage, datatype?: NamedNodeLike): LiteralLike;
  variable?(value: string): VariableLike;
  defaultGraph(): DefaultGraphLike;
  quad(subject: TermLike, predicate: TermLike, object: TermLike, graph?: TermLike): QuadLike;
}

export type TermLike = RDFJS.Term;
export type NamedNodeLike = RDFJS.NamedNode;
export type BlankNodeLike = RDFJS.BlankNode;
export type VariableLike = RDFJS.Variable;
export type DefaultGraphLike = RDFJS.DefaultGraph;
export type LiteralLike = RDFJS.Literal;
export type QuadLike = RDFJS.BaseQuad;

export interface MessageQuad {
  quad: QuadLike;
  messageCounter: number;
}

export type ParserOutput = QuadLike[] | MessageQuadArray;
export type ParserOutputItem = QuadLike | MessageQuad;
export type ParseCallback = (
  error: Error | null,
  quad?: QuadLike | null,
  prefixes?: Record<string, NamedNodeLike>,
  messageCounter?: number,
) => void;

export interface MessageQuadArray extends Array<MessageQuad> {
  messageCount: number;
}

export type ParserEventCallbacks = {
  prefix?: (prefix: string, iri: NamedNodeLike) => void;
  comment?: (comment: string) => void;
};

type CoreParserState = {
  prefixes: Record<string, NamedNodeLike>;
  baseIRI: string;
  version?: string;
  messagesEnabled: boolean;
  messageCounter: number;
  messageCountHint: number;
  afterMessageDelimiter: boolean;
  localBlankNodeCounter: number;
  line: number;
  blankNodeLabels: Map<string, BlankNodeLike>;
  namedNodeCache: Map<string, NamedNodeLike>;
};

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDF_TYPE = `${RDF}type`;
const RDF_REIFIES = `${RDF}reifies`;
const RDF_FIRST = `${RDF}first`;
const RDF_REST = `${RDF}rest`;
const RDF_NIL = `${RDF}nil`;
const RDF_LANG_STRING = `${RDF}langString`;
const RDF_DIR_LANG_STRING = `${RDF}dirLangString`;
const XSD_STRING = `${XSD}string`;
const XSD_INTEGER = `${XSD}integer`;
const XSD_DECIMAL = `${XSD}decimal`;
const XSD_DOUBLE = `${XSD}double`;
const XSD_BOOLEAN = `${XSD}boolean`;
type LiteralDirection = RDFJS.DirectionalLanguage['direction'];

function sameTerm(a: TermLike, b: unknown): boolean {
  if (!b || typeof b !== 'object' || !('termType' in b) || !('value' in b)) return false;
  const other = b as TermLike;
  if (a.termType !== other.termType || a.value !== other.value) return false;
  if (a.termType === 'Literal' && other.termType === 'Literal') {
    return a.language === other.language && a.direction === other.direction && a.datatype.equals(other.datatype);
  }
  if (a.termType === 'Quad' && other.termType === 'Quad') {
    return a.subject.equals(other.subject) && a.predicate.equals(other.predicate) &&
      a.object.equals(other.object) && a.graph.equals(other.graph);
  }
  return true;
}

export class NamedNode implements NamedNodeLike {
  public readonly termType = 'NamedNode' as const;
  public constructor(public readonly value: string) {}
  public equals(other: unknown): boolean { return sameTerm(this, other); }
}

export class BlankNode implements BlankNodeLike {
  public readonly termType = 'BlankNode' as const;
  public constructor(public readonly value: string) {}
  public equals(other: unknown): boolean { return sameTerm(this, other); }
}

export class Variable implements VariableLike {
  public readonly termType = 'Variable' as const;
  public constructor(public readonly value: string) {}
  public equals(other: unknown): boolean { return sameTerm(this, other); }
}

export class DefaultGraph implements DefaultGraphLike {
  public readonly termType = 'DefaultGraph' as const;
  public readonly value = '';
  public equals(other: unknown): boolean { return sameTerm(this, other); }
}

export class Literal implements LiteralLike {
  public readonly termType = 'Literal' as const;
  public readonly direction?: LiteralDirection;

  public constructor(
    public readonly value: string,
    public readonly language = '',
    public readonly datatype: NamedNodeLike = new NamedNode(language ? RDF_LANG_STRING : XSD_STRING),
    direction?: LiteralDirection,
  ) {
    if (direction) this.direction = direction;
  }

  public equals(other: unknown): boolean { return sameTerm(this, other); }
}

export class Quad implements QuadLike {
  public readonly termType = 'Quad' as const;
  public readonly value = '';

  public constructor(
    public readonly subject: TermLike,
    public readonly predicate: TermLike,
    public readonly object: TermLike,
    public readonly graph: TermLike = defaultGraphSingleton,
  ) {}

  public equals(other: unknown): boolean { return sameTerm(this, other); }
}

export class Message extends Array<QuadLike> {
  public static override get [Symbol.species](): ArrayConstructor { return Array; }

  public constructor(public readonly messageCounter: number, quads: Iterable<QuadLike> = []) {
    super();
    Object.setPrototypeOf(this, Message.prototype);
    for (const quad of quads) this.push(quad);
  }
}

const defaultGraphSingleton = new DefaultGraph();

let globalBlankNodeCounter = 0;

export const DataFactory: DataFactoryLike = {
  namedNode: value => new NamedNode(value),
  blankNode: value => new BlankNode(value ?? `b${globalBlankNodeCounter++}`),
  literal: (value, languageOrDatatype, datatype) => {
    if (typeof languageOrDatatype === 'string') {
      const directionalSeparator = languageOrDatatype.indexOf('--');
      if (directionalSeparator >= 0) {
        const language = languageOrDatatype.slice(0, directionalSeparator).toLowerCase();
        const direction = languageOrDatatype.slice(directionalSeparator + 2).toLowerCase() as LiteralDirection;
        return new Literal(value, language, datatype ?? new NamedNode(RDF_LANG_STRING), direction);
      }
      const language = languageOrDatatype.toLowerCase();
      return new Literal(value, language, datatype ?? new NamedNode(language ? RDF_LANG_STRING : XSD_STRING));
    }
    if (isDirectionalLanguage(languageOrDatatype)) {
      return new Literal(
        value,
        languageOrDatatype.language.toLowerCase(),
        datatype ?? new NamedNode(RDF_LANG_STRING),
        languageOrDatatype.direction,
      );
    }
    return new Literal(value, '', languageOrDatatype ?? datatype ?? new NamedNode(XSD_STRING));
  },
  variable: value => new Variable(value),
  defaultGraph: () => defaultGraphSingleton,
  quad: (subject, predicate, object, graph = defaultGraphSingleton) => new Quad(subject, predicate, object, graph),
};

function isDirectionalLanguage(value: unknown): value is RDFJS.DirectionalLanguage {
  return Boolean(value && typeof value === 'object' && 'language' in value && !('termType' in value));
}

export class Parser {
  public static _resetBlankNodePrefix(): void { globalBlankNodeCounter = 0; }
  public _factory: DataFactoryLike;

  private readonly options: ParserOptions;

  public constructor(options: ParserOptions = {}) {
    this.options = options;
    this._factory = options.factory ?? DataFactory;
  }

  public parse(input: string, callback?: ParseCallback): ParserOutput | undefined {
    try {
      const core = new CoreParser(input, this.options, {
        prefix: (prefix, iri) => undefined,
        comment: comment => undefined,
      });
      const result = core.parse();
      if (callback) {
        if (result.messagesEnabled) {
          for (const entry of result.messageQuads) callback(null, entry.quad, result.prefixes, entry.messageCounter);
        } else {
          for (const quad of result.quads) callback(null, quad, result.prefixes);
        }
        callback(null, null, result.prefixes);
        return undefined;
      }
      return result.messagesEnabled ? result.messageQuads : result.quads;
    } catch (error) {
      if (callback) {
        callback(error instanceof Error ? error : new Error(String(error)));
        return undefined;
      }
      throw error;
    }
  }

  public parseMessages(input: string): Message[] {
    const core = new CoreParser(input, { ...this.options, rdfMessages: true }, {
      prefix: (prefix, iri) => undefined,
      comment: comment => undefined,
    });
    const result = core.parse();
    return toMessages(result.messageQuads);
  }
}

function createInitialCoreParserState(options: ParserOptions): CoreParserState {
  return {
    prefixes: Object.create(null) as Record<string, NamedNodeLike>,
    baseIRI: options.baseIRI ?? options.baseIRIPath ?? '',
    version: options.version,
    messagesEnabled: options.rdfMessages === true || options.messages === true || isMessagesVersion(options.version),
    messageCounter: 0,
    messageCountHint: 0,
    afterMessageDelimiter: false,
    localBlankNodeCounter: 0,
    line: 1,
    blankNodeLabels: new Map<string, BlankNodeLike>(),
    namedNodeCache: new Map<string, NamedNodeLike>(),
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
      if (end < 0) break;
      i = end;
      continue;
    }
    if (code === 34 || code === 39) {
      const end = scanQuotedStringEnd(input, i);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (code === 60 && input.charCodeAt(i + 1) !== 60) {
      const end = scanIriEnd(input, i);
      if (end < 0) break;
      i = end;
      continue;
    }

    if (code === 123) graphDepth++;
    else if (code === 125 && graphDepth > 0) graphDepth--;
    else if (code === 91 || code === 40) bracketDepth++;
    else if ((code === 93 || code === 41) && bracketDepth > 0) bracketDepth--;
    else if (code === 46 && graphDepth === 0 && bracketDepth === 0 && isStatementDotBoundary(input, i)) {
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
    if (code === 10) return i + 1;
    if (code === 13) return input.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
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
      if (i + 1 >= input.length) return -1;
      i += 2;
      continue;
    }
    if (code === quote) {
      if (!triple) return i + 1;
      if (input.charCodeAt(i + 1) === quote && input.charCodeAt(i + 2) === quote) return i + 3;
    }
    i++;
  }
  return -1;
}

function scanIriEnd(input: string, index: number): number {
  for (let i = index + 1; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 92) {
      if (i + 1 >= input.length) return -1;
      i++;
      continue;
    }
    if (code === 62) return i + 1;
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
      if (end < 0) return i;
      i = end;
      continue;
    }
    break;
  }
  return i;
}

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

  public write(input: string): ParserOutputItem[] {
    this.appendInput(input);
    return this.parsePending(false);
  }

  public end(input = ''): ParserOutputItem[] {
    this.appendInput(input);
    return this.parsePending(true);
  }

  private appendInput(input: string): void {
    if (!input) return;
    if (this.atStart) {
      this.atStart = false;
      this.pending += input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
      return;
    }
    this.pending += input;
  }

  private parsePending(final: boolean): ParserOutputItem[] {
    const end = final ? this.pending.length : findCompleteParseEnd(this.pending);
    if (end <= 0 && !final) return [];

    const input = final ? this.pending : this.pending.slice(0, end);
    if (!input && !final) return [];

    const parser = new CoreParser(input, this.options, this.callbacks, this.parserState);
    const result = parser.parse(final);
    this.parserState = parser.exportState();
    this.pending = final ? '' : this.pending.slice(end);

    return result.messagesEnabled ? [...result.messageQuads] : [...result.quads];
  }
}

export class StreamParser extends Transform {
  private readonly decoder = new StringDecoder('utf8');
  private readonly options: ParserOptions;
  private parserState: CoreParserState;
  private pending = '';
  private atStart = true;

  public constructor(options: StreamParserOptions = {}) {
    const { baseIRI, baseIRIPath, format, factory, comments, relax, rdfMessages, messages, parseUnsupportedVersions, version, ...streamOptions } = options;
    super({ ...streamOptions, readableObjectMode: true });
    this.options = { baseIRI, baseIRIPath, format, factory, comments, relax, rdfMessages, messages, parseUnsupportedVersions, version };
    this.parserState = createInitialCoreParserState(this.options);
  }

  public import(stream: Readable): this {
    stream.on('error', error => this.emit('error', error));
    stream.pipe(this);
    return this;
  }

  public override _transform(chunk: Buffer | string, encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.appendInput(this.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)));
      this.parsePending(false);
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  public override _flush(callback: TransformCallback): void {
    try {
      this.appendInput(this.decoder.end());
      this.parsePending(true);
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private appendInput(input: string): void {
    if (!input) return;
    if (this.atStart) {
      this.atStart = false;
      this.pending += input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
      return;
    }
    this.pending += input;
  }

  private parsePending(final: boolean): void {
    const end = final ? this.pending.length : findCompleteParseEnd(this.pending);
    if (end <= 0 && !final) return;

    const input = final ? this.pending : this.pending.slice(0, end);
    if (!input && !final) return;

    const parser = new CoreParser(input, this.options, {
      prefix: (prefix, iri) => this.emit('prefix', prefix, iri),
      comment: comment => this.emit('comment', comment),
    }, this.parserState);
    const result = parser.parse(final);
    this.parserState = parser.exportState();

    if (result.messagesEnabled) {
      for (const entry of result.messageQuads) {
        this.emit('messageCounter', entry.messageCounter, entry.quad);
        this.push(entry);
      }
    } else {
      for (const quad of result.quads) this.push(quad);
    }

    this.pending = final ? '' : this.pending.slice(end);
  }
}

class CoreParser {
  private readonly input: string;
  private readonly length: number;
  private index = 0;
  private line: number;
  private readonly factory: DataFactoryLike;
  private readonly prefixes: Record<string, NamedNodeLike>;
  private readonly quads: QuadLike[] = [];
  private readonly messageQuads: MessageQuadArray = Object.assign([], { messageCount: 0 }) as MessageQuadArray;
  private readonly callbacks: ParserEventCallbacks;
  private readonly strictNTriples: boolean;
  private readonly strictNQuads: boolean;
  private readonly allowDotlessGraphTerminator: boolean;
  private readonly relax: boolean;
  private readonly defaultGraphTerm: DefaultGraphLike;
  private readonly namedNodeCache: Map<string, NamedNodeLike>;
  private readonly blankNodeLabels: Map<string, BlankNodeLike>;
  private baseIRI: string;
  private version?: string;
  private messagesEnabled: boolean;
  private messageCounter = 0;
  private messageCountHint = 0;
  private afterMessageDelimiter = false;
  private localBlankNodeCounter = 0;
  private fastEnd = 0;

  public constructor(input: string, options: ParserOptions, callbacks: ParserEventCallbacks, state?: CoreParserState) {
    this.input = state ? input : input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
    this.length = this.input.length;
    this.factory = options.factory ?? DataFactory;
    this.prefixes = state?.prefixes ?? Object.create(null) as Record<string, NamedNodeLike>;
    this.baseIRI = state?.baseIRI ?? options.baseIRI ?? options.baseIRIPath ?? '';
    this.callbacks = callbacks;
    this.relax = options.relax === true;
    this.defaultGraphTerm = this.factory.defaultGraph();
    this.version = state?.version ?? options.version;
    this.messagesEnabled = state?.messagesEnabled ?? (options.rdfMessages === true || options.messages === true || isMessagesVersion(options.version));
    this.messageCounter = state?.messageCounter ?? 0;
    this.messageCountHint = state?.messageCountHint ?? 0;
    this.afterMessageDelimiter = state?.afterMessageDelimiter ?? false;
    this.localBlankNodeCounter = state?.localBlankNodeCounter ?? 0;
    this.line = state?.line ?? 1;
    this.blankNodeLabels = state?.blankNodeLabels ?? new Map<string, BlankNodeLike>();
    this.namedNodeCache = state?.namedNodeCache ?? new Map<string, NamedNodeLike>();
    const format = (options.format ?? '').toLowerCase();
    this.strictNTriples = format.includes('n-triples');
    this.strictNQuads = format.includes('n-quads');
    this.allowDotlessGraphTerminator = format === '' || format.includes('trig');
  }

  public parse(final = true): { quads: QuadLike[]; messageQuads: MessageQuadArray; prefixes: Record<string, NamedNodeLike>; messagesEnabled: boolean } {
    while (true) {
      this.skipWsAndComments();
      if (this.index >= this.length) {
        if (final) this.finalizeEndOfFileMessage();
        return { quads: this.quads, messageQuads: this.messageQuads, prefixes: this.prefixes, messagesEnabled: this.messagesEnabled };
      }
      if ((this.strictNTriples || this.strictNQuads) && this.tryParseLineStatementFast()) continue;
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
    if (!subject || subject.termType === 'Quad') return false;
    i = this.skipHws(this.fastEnd);

    const predicateEnd = this.readFastIriEnd(i);
    if (predicateEnd < 0) return false;
    const predicate = this.cachedNamedNode(this.input.slice(i + 1, predicateEnd));
    i = this.skipHws(predicateEnd + 1);

    const object = this.readFastObject(i);
    if (!object) return false;
    i = this.skipHws(this.fastEnd);

    let graph: TermLike = this.defaultGraphTerm;
    const graphStart = this.input.charCodeAt(i);
    if (graphStart === 60 || (graphStart === 95 && this.input.charCodeAt(i + 1) === 58)) {
      if (this.strictNTriples) return false;
      graph = this.readFastNode(i, true) ?? this.defaultGraphTerm;
      if (graph === this.defaultGraphTerm && this.input.charCodeAt(i) !== 46) return false;
      if (graph.termType === 'Quad' || graph.termType === 'Literal') return false;
      i = this.skipHws(this.fastEnd);
    }

    if (this.input.charCodeAt(i) !== 46) return false;
    this.index = i + 1;
    this.addQuad(subject, predicate, object, graph);
    return true;
  }

  private readFastObject(index: number): TermLike | null {
    const code = this.input.charCodeAt(index);
    if (code === 60) {
      if (this.input.charCodeAt(index + 1) === 60) return this.relax ? this.readFastTripleTerm(index) : null;
      const end = this.readFastIriEnd(index);
      if (end < 0) return null;
      this.fastEnd = end + 1;
      return this.factory.namedNode(this.input.slice(index + 1, end));
    }
    if (code === 95 && this.input.charCodeAt(index + 1) === 58) return this.readFastBlankNode(index);
    if (code === 34) return this.readFastLiteral(index);
    return null;
  }

  private readFastTripleTerm(index: number): TermLike | null {
    let i = index + 2;
    i = this.skipHws(i);
    if (this.input.charCodeAt(i) !== 40) return null;
    i = this.skipHws(i + 1);

    const subject = this.readFastNode(i, false);
    if (!subject || subject.termType === 'Quad') return null;
    i = this.skipHws(this.fastEnd);

    const predicateEnd = this.readFastIriEnd(i);
    if (predicateEnd < 0) return null;
    const predicate = this.cachedNamedNode(this.input.slice(i + 1, predicateEnd));
    i = this.skipHws(predicateEnd + 1);

    const object = this.readFastObject(i);
    if (!object) return null;
    i = this.skipHws(this.fastEnd);

    if (this.input.charCodeAt(i) !== 41 || this.input.charCodeAt(i + 1) !== 62 || this.input.charCodeAt(i + 2) !== 62) return null;
    this.fastEnd = i + 3;
    return this.factory.quad(subject, predicate, object, this.factory.defaultGraph());
  }

  private readFastNode(index: number, cache: boolean): TermLike | null {
    const code = this.input.charCodeAt(index);
    if (code === 60) {
      if (this.input.charCodeAt(index + 1) === 60) return null;
      const end = this.readFastIriEnd(index);
      if (end < 0) return null;
      this.fastEnd = end + 1;
      const value = this.input.slice(index + 1, end);
      return cache ? this.cachedNamedNode(value) : this.factory.namedNode(value);
    }
    if (code === 95 && this.input.charCodeAt(index + 1) === 58) return this.readFastBlankNode(index);
    return null;
  }

  private readFastBlankNode(index: number): BlankNodeLike | null {
    let i = index + 2;
    const start = i;
    while (i < this.length) {
      const code = this.input.charCodeAt(i);
      if (!isNameChar(code)) break;
      if (code === 46) {
        const next = this.input.charCodeAt(i + 1);
        if (Number.isNaN(next) || isWs(next) || next === 59 || next === 44 || next === 125 || next === 93 || next === 41) break;
      }
      i++;
    }
    if (i === start) return null;
    this.fastEnd = i;
    return this.blankNodeFromLabel(this.input.slice(start, i));
  }

  private readFastLiteral(index: number): LiteralLike | null {
    const end = this.input.indexOf('"', index + 1);
    if (end < 0) return null;
    for (let i = index + 1; i < end; i++) {
      const code = this.input.charCodeAt(i);
      if (code === 92 || code === 10 || code === 13) return null;
    }

    const value = this.input.slice(index + 1, end);
    let i = end + 1;
    const next = this.input.charCodeAt(i);
    if (next === 64) {
      const start = ++i;
      while (i < this.length) {
        const code = this.input.charCodeAt(i);
        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45) i++;
        else break;
      }
      if (i === start) return null;
      const tag = this.input.slice(start, i);
      if (!this.relax && !isLanguageTagValid(tag)) return null;
      this.fastEnd = i;
      return this.factory.literal(value, tag.toLowerCase());
    }
    if (next === 94 && this.input.charCodeAt(i + 1) === 94) {
      i += 2;
      const datatypeEnd = this.readFastIriEnd(i);
      if (datatypeEnd < 0) return null;
      const datatypeValue = this.input.slice(i + 1, datatypeEnd);
      if (!this.relax && (datatypeValue === RDF_LANG_STRING || datatypeValue === RDF_DIR_LANG_STRING)) return null;
      this.fastEnd = datatypeEnd + 1;
      return this.factory.literal(value, this.cachedNamedNode(datatypeValue));
    }
    this.fastEnd = i;
    return this.factory.literal(value);
  }

  private readFastIriEnd(index: number): number {
    if (this.input.charCodeAt(index) !== 60) return -1;
    const end = this.input.indexOf('>', index + 1);
    if (end < 0) return -1;
    if (this.relax) return end;

    let hasScheme = false;
    for (let i = index + 1; i < end; i++) {
      const code = this.input.charCodeAt(i);
      if (code === 58 && i > index + 1) hasScheme = true;
      if (code <= 32 || code === 34 || code === 60 || code === 92 || code === 94 || code === 96 || code === 123 || code === 124 || code === 125) {
        return -1;
      }
    }
    return hasScheme ? end : -1;
  }

  private skipHws(index: number): number {
    while (index < this.length) {
      const code = this.input.charCodeAt(index);
      if (code !== 32 && code !== 9) break;
      index++;
    }
    return index;
  }

  private cachedNamedNode(value: string): NamedNodeLike {
    const cached = this.namedNodeCache.get(value);
    if (cached) return cached;
    const node = this.factory.namedNode(value);
    if (this.namedNodeCache.size < 4096) this.namedNodeCache.set(value, node);
    return node;
  }

  private parseStatement(defaultGraph: TermLike, allowGraphCloseTerminator = false, insideGraphBlock = false): boolean {
    this.skipWsAndComments();
    if (this.parseDirective(defaultGraph)) return false;
    if (this.peekCharCode() === 123) {
      if (insideGraphBlock) this.fail('Graph blocks are not allowed inside graph blocks');
      this.index++;
      this.parseGraphStatements(defaultGraph);
      return false;
    }
    if (this.matchWord('GRAPH')) {
      if (insideGraphBlock) this.fail('Graph blocks are not allowed inside graph blocks');
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
      if (insideGraphBlock) this.fail('Graph blocks are not allowed inside graph blocks');
      this.assertGraphLabel(subjectOrGraph, termStart, termEnd);
      this.index++;
      this.parseGraphStatements(subjectOrGraph);
      return false;
    }
    if (this.isBlankNodePropertyListSubject(termStart, termEnd)) {
      if (this.peekCharCode() === 46) {
        this.index++;
        return false;
      }
      if (allowGraphCloseTerminator && this.peekCharCode() === 125) return true;
    }
    return this.parsePredicateObjectList(subjectOrGraph, defaultGraph, 46, allowGraphCloseTerminator);
  }

  private parseGraphStatements(graph: TermLike): void {
    let lastStatementClosedByGraph = false;
    while (true) {
      this.skipWsAndComments();
      if (this.index >= this.length) this.fail('Unclosed graph block');
      if (this.peekCharCode() === 125) {
        this.index++;
        this.skipWsAndComments();
        if (lastStatementClosedByGraph && this.peekCharCode() === 46) this.fail('Expected . after triple');
        if (this.peekCharCode() === 46) this.index++;
        return;
      }
      lastStatementClosedByGraph = this.parseStatement(graph, this.allowDotlessGraphTerminator, true);
    }
  }

  private parsePredicateObjectList(subject: TermLike, graph: TermLike, terminatorCode = 46, allowGraphCloseTerminator = false): boolean {
    while (true) {
      const predicate = this.parsePredicate(graph);
      this.skipWsAndComments();
      while (true) {
        const object = this.parseObject(graph);
        this.skipWsAndComments();

        if (terminatorCode === 46 && !allowGraphCloseTerminator && graph.termType === 'DefaultGraph' && this.canStartTerm() && !this.nextIsStatementBoundary()) {
          if (this.strictNTriples) this.fail('Graph terms are not allowed in N-Triples');
          const explicitGraph = this.parseNamedOrBlankTerm(graph);
          this.addQuad(subject, predicate, object, explicitGraph);
          this.skipWsAndComments();
          this.expectChar(46, 'Expected . after quad');
          return false;
        }

        this.addQuad(subject, predicate, object, graph);
        if (this.peekCharCode() !== 44) break;
        if (this.strictNTriples || this.strictNQuads) this.fail('Object lists are not allowed in this format');
        this.index++;
        this.skipWsAndComments();
      }

      if (this.peekCharCode() !== 59) break;
      if (this.strictNTriples || this.strictNQuads) this.fail('Predicate lists are not allowed in this format');
      this.index++;
      this.skipWsAndComments();
      if (this.peekCharCode() === terminatorCode || (allowGraphCloseTerminator && this.peekCharCode() === 125)) break;
    }
    if (allowGraphCloseTerminator && this.peekCharCode() === 125) return true;
    if (terminatorCode === 46) this.expectChar(46, 'Expected . after triple');
    else if (this.peekCharCode() !== terminatorCode) this.fail(`Expected ${String.fromCharCode(terminatorCode)} after property list`);
    return false;
  }

  private addQuad(subject: TermLike, predicate: TermLike, object: TermLike, graph: TermLike): void {
    const quad = this.factory.quad(subject, predicate, object, graph);
    this.quads.push(quad);
    if (this.messagesEnabled) {
      this.messageQuads.push({ quad, messageCounter: this.messageCounter });
      this.messageCountHint = Math.max(this.messageCountHint, this.messageCounter + 1);
      this.afterMessageDelimiter = false;
    }
  }

  private parseDirective(currentGraph: TermLike): boolean {
    const start = this.index;
    if (this.peekCharCode() === 64) {
      if (this.strictNTriples || this.strictNQuads) this.fail('Directives are not allowed in this format');
      this.index++;
      if (this.matchWord('version')) {
        this.parseVersionDirective(true);
        return true;
      }
      if (this.matchWord('prefix')) {
        this.parsePrefixDirective(true);
        return true;
      }
      if (this.matchWord('base')) {
        this.parseBaseDirective(true);
        return true;
      }
      if (this.matchWord('message', true)) {
        this.parseMessageDirective(true, currentGraph);
        return true;
      }
      this.index = start;
      return false;
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
      if (this.strictNTriples || this.strictNQuads) this.fail('Directives are not allowed in this format');
      this.parsePrefixDirective(false);
      return true;
    }
    if (this.matchWord('BASE')) {
      if (this.strictNTriples || this.strictNQuads) this.fail('Directives are not allowed in this format');
      this.parseBaseDirective(false);
      return true;
    }
    return false;
  }

  private parseVersionDirective(needsDot: boolean): void {
    this.skipWsAndComments();
    this.version = this.readQuotedString();
    if (isMessagesVersion(this.version)) this.messagesEnabled = true;
    this.skipWsAndComments();
    if (needsDot) this.expectChar(46, 'Expected . after version directive');
  }

  private parseMessageDirective(needsDot: boolean, currentGraph: TermLike): void {
    if (!this.messagesEnabled) this.fail('RDF Messages are not enabled');
    if (currentGraph.termType !== 'DefaultGraph') this.fail('Message delimiters are not allowed inside graph blocks');
    this.skipWsAndComments();
    if (needsDot) this.expectChar(46, 'Expected . after message directive');
    this.finishMessage();
  }

  private parsePrefixDirective(needsDot: boolean): void {
    this.skipWsAndComments();
    const prefix = this.readUntilColon();
    this.expectChar(58, 'Expected : after prefix label');
    this.skipWsAndComments();
    const iri = this.parseIri();
    this.prefixes[prefix] = iri;
    this.callbacks.prefix?.(prefix, iri);
    this.skipWsAndComments();
    if (needsDot) this.expectChar(46, 'Expected . after prefix directive');
  }

  private parseBaseDirective(needsDot: boolean): void {
    this.skipWsAndComments();
    this.baseIRI = this.parseIri().value;
    this.skipWsAndComments();
    if (needsDot) this.expectChar(46, 'Expected . after base directive');
  }

  private parseSubject(graph: TermLike): TermLike {
    const term = this.parseTerm(graph);
    if (term.termType === 'Literal' || term.termType === 'DefaultGraph' || term.termType === 'Variable' ||
      ((this.strictNTriples || this.strictNQuads) && term.termType === 'Quad')) {
      this.fail(`Invalid subject term ${term.termType}`);
    }
    return term;
  }

  private parseObject(graph: TermLike): TermLike {
    return this.parseTerm(graph);
  }

  private parsePredicate(graph: TermLike): TermLike {
    if (this.matchWord('a')) return this.factory.namedNode(RDF_TYPE);
    const term = this.parseTerm(graph);
    if (term.termType !== 'NamedNode') this.fail(`Invalid predicate term ${term.termType}`);
    return term;
  }

  private parseNamedOrBlankTerm(graph: TermLike): TermLike {
    const term = this.parseTerm(graph);
    if (term.termType !== 'NamedNode' && term.termType !== 'BlankNode') this.fail(`Invalid graph term ${term.termType}`);
    return term;
  }

  private parseGraphLabel(graph: TermLike): TermLike {
    const start = this.index;
    const term = this.parseNamedOrBlankTerm(graph);
    this.assertGraphLabel(term, start);
    return term;
  }

  private assertGraphLabel(term: TermLike, start: number, end = this.index): void {
    if (term.termType !== 'NamedNode' && term.termType !== 'BlankNode') this.fail(`Invalid graph term ${term.termType}`);
    const code = this.input.charCodeAt(start);
    if ((code === 91 && !this.isAnonymousBlankNodeLabel(start, end)) || code === 40 || (code === 60 && this.input.charCodeAt(start + 1) === 60)) {
      this.fail(`Invalid graph term ${term.termType}`);
    }
  }

  private isAnonymousBlankNodeLabel(start: number, end: number): boolean {
    if (this.input.charCodeAt(start) !== 91 || this.input.charCodeAt(end - 1) !== 93) return false;
    let i = start + 1;
    while (i < end - 1) {
      const code = this.input.charCodeAt(i);
      if (isWs(code)) {
        i++;
        continue;
      }
      if (code === 35) {
        const commentEnd = scanCommentEnd(this.input, i);
        if (commentEnd < 0 || commentEnd > end - 1) return false;
        i = commentEnd;
        continue;
      }
      return false;
    }
    return true;
  }

  private isBlankNodePropertyListSubject(start: number, end: number): boolean {
    return this.input.charCodeAt(start) === 91 && !this.isAnonymousBlankNodeLabel(start, end);
  }

  private parseTerm(graph: TermLike): TermLike {
    this.skipWsAndComments();
    const code = this.peekCharCode();
    if (code < 0) this.fail('Unexpected end of input');

    if (code === 60) {
      if (this.input.charCodeAt(this.index + 1) === 60) return this.parseDoubleAngleTerm(graph);
      return this.parseIri();
    }
    if (code === 34 || code === 39) return this.parseLiteral();
    if (code === 95 && this.input.charCodeAt(this.index + 1) === 58) return this.parseBlankNode();
    if (code === 91) return this.parseBlankNodePropertyList(graph);
    if (code === 40) return this.parseCollection(graph);
    if (code === 43 || code === 45 || (code >= 48 && code <= 57)) return this.parseNumber();
    if ((this.strictNTriples || this.strictNQuads) && (this.matchWord('true', true) || this.matchWord('false', true))) {
      this.fail('Boolean literals are not allowed in this format');
    }
    if (this.matchWord('true', true)) return this.factory.literal('true', this.factory.namedNode(XSD_BOOLEAN));
    if (this.matchWord('false', true)) return this.factory.literal('false', this.factory.namedNode(XSD_BOOLEAN));
    return this.parsePrefixedName();
  }

  private parseDoubleAngleTerm(graph: TermLike): TermLike {
    this.index += 2;
    this.skipWsAndComments();
    if (this.peekCharCode() === 40) return this.parseTripleTerm(graph);
    if (this.strictNTriples || this.strictNQuads) this.fail('Reified triples are not allowed in this format');
    return this.parseReifiedTriple(graph);
  }

  private parseTripleTerm(graph: TermLike): TermLike {
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

  private parseReifiedTriple(graph: TermLike): TermLike {
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

  private parseReifiedTripleSubject(graph: TermLike): TermLike {
    const start = this.index;
    const term = this.parseTerm(graph);
    this.assertReifiedTripleTerm(term, start, 'subject');
    if (term.termType === 'Literal' || term.termType === 'Quad') this.fail(`Invalid reified triple subject term ${term.termType}`);
    return term;
  }

  private parseReifiedTripleObject(graph: TermLike): TermLike {
    const start = this.index;
    const term = this.parseTerm(graph);
    this.assertReifiedTripleTerm(term, start, 'object');
    return term;
  }

  private parseReifier(graph: TermLike): TermLike {
    this.index++;
    this.skipWsAndComments();
    if (this.input.charCodeAt(this.index) === 62 && this.input.charCodeAt(this.index + 1) === 62) return this.createFreshBlankNode();
    const start = this.index;
    const term = this.parseTerm(graph);
    this.assertReifiedTripleTerm(term, start, 'reifier');
    if (term.termType !== 'NamedNode' && term.termType !== 'BlankNode') this.fail(`Invalid reifier term ${term.termType}`);
    return term;
  }

  private assertReifiedTripleTerm(term: TermLike, start: number, position: string, end = this.index): void {
    if (term.termType === 'DefaultGraph' || term.termType === 'Variable') this.fail(`Invalid reified triple ${position} term ${term.termType}`);
    const code = this.input.charCodeAt(start);
    if (code === 40 || (code === 91 && !this.isAnonymousBlankNodeLabel(start, end))) {
      this.fail(`Invalid reified triple ${position} term ${term.termType}`);
    }
  }

  private parseIri(): NamedNodeLike {
    this.expectChar(60, 'Expected <');
    let value = '';
    while (this.index < this.length) {
      const code = this.peekCharCode();
      if (code === 62) {
        this.index++;
        if ((this.strictNTriples || this.strictNQuads) && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
          this.fail('Relative IRIs are not allowed in this format');
        }
        return this.factory.namedNode(resolveIri(value, this.baseIRI));
      }
      if (code === 92) {
        this.index++;
        const escapeCode = this.peekCharCode();
        if ((this.strictNTriples || this.strictNQuads) && escapeCode !== 117 && escapeCode !== 85) {
          this.fail('Only Unicode escapes are allowed in IRIs');
        }
        const escaped = this.readEscape();
        if (isInvalidIriChar(escaped.codePointAt(0) ?? -1)) this.fail('Invalid character in IRI');
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

  private parseLiteral(): LiteralLike {
    if ((this.strictNTriples || this.strictNQuads) && this.peekCharCode() !== 34) {
      this.fail('Only double-quoted literals are allowed in this format');
    }
    const value = this.readQuotedString();
    if (this.peekCharCode() === 64) {
      this.index++;
      const tag = this.readLanguageTag();
      return this.factory.literal(value, tag);
    }
    if (this.peekCharCode() === 94 && this.input.charCodeAt(this.index + 1) === 94) {
      this.index += 2;
      const datatype = this.parseTerm(this.factory.defaultGraph());
      if (datatype.termType !== 'NamedNode') this.fail('Expected datatype IRI after ^^');
      if ((this.strictNTriples || this.strictNQuads) && (datatype.value === RDF_LANG_STRING || datatype.value === RDF_DIR_LANG_STRING)) {
        this.fail('Language string datatypes require an explicit language tag');
      }
      return this.factory.literal(value, datatype);
    }
    return this.factory.literal(value);
  }

  private parseBlankNode(): BlankNodeLike {
    this.index += 2;
    const start = this.index;
    while (this.index < this.length && isNameChar(this.peekCharCode())) {
      if (this.peekCharCode() === 46) {
        const next = this.input.charCodeAt(this.index + 1);
        if (Number.isNaN(next) || isWs(next) || next === 59 || next === 44 || next === 125 || next === 93 || next === 41) break;
      }
      this.index++;
    }
    if (this.index === start) this.fail('Expected blank node label');
    return this.blankNodeFromLabel(this.input.slice(start, this.index));
  }

  private parseBlankNodePropertyList(graph: TermLike): BlankNodeLike {
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

  private parseCollection(graph: TermLike): TermLike {
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

  private blankNodeFromLabel(label: string): BlankNodeLike {
    if (!this.messagesEnabled) return this.factory.blankNode(label);
    const existing = this.blankNodeLabels.get(label);
    if (existing) return existing;
    const blank = this.createBlankNode(label);
    this.blankNodeLabels.set(label, blank);
    return blank;
  }

  private createBlankNode(label: string): BlankNodeLike {
    return this.messagesEnabled ? this.factory.blankNode(`m${this.messageCounter}_${label}`) : this.factory.blankNode(label);
  }

  private createFreshBlankNode(): BlankNodeLike {
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
    if (!this.messagesEnabled) return;
    if (!this.afterMessageDelimiter) this.messageCountHint = Math.max(this.messageCountHint, this.messageCounter + 1);
    this.messageQuads.messageCount = this.messageCountHint;
  }

  private parseNumber(): LiteralLike {
    if (this.strictNTriples || this.strictNQuads) this.fail('Numeric literals are not allowed in this format');
    const rest = this.input.slice(this.index);
    const match = /^[+-]?(?:(?:\d+\.\d*|\.\d+|\d+)[eE][+-]?\d+|(?:\d*\.\d+)|(?:\d+))/.exec(rest);
    if (!match?.[0]) this.fail('Invalid number');
    const value = match[0];
    this.index += value.length;
    let datatype = XSD_INTEGER;
    if (/[eE]/.test(value)) datatype = XSD_DOUBLE;
    else if (value.includes('.')) datatype = XSD_DECIMAL;
    return this.factory.literal(value, this.factory.namedNode(datatype));
  }

  private parsePrefixedName(): NamedNodeLike {
    const prefix = this.readUntilColon();
    this.expectChar(58, 'Expected prefixed name');
    const localStart = this.index;
    while (this.index < this.length) {
      const code = this.peekCharCode();
      if (!isLocalNameChar(code)) break;
      if (code === 46) {
        const next = this.input.charCodeAt(this.index + 1);
        if (Number.isNaN(next) || isWs(next) || next === 59 || next === 44 || next === 125 || next === 93 || next === 41) break;
      }
      this.index++;
    }
    const namespace = this.prefixes[prefix];
    if (!namespace) this.fail(`Unknown prefix "${prefix}"`);
    return this.factory.namedNode(namespace.value + this.input.slice(localStart, this.index));
  }

  private readQuotedString(): string {
    const quote = this.peekCharCode();
    const triple = this.input.charCodeAt(this.index + 1) === quote && this.input.charCodeAt(this.index + 2) === quote;
    if ((this.strictNTriples || this.strictNQuads) && triple) this.fail('Long literals are not allowed in this format');
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
      if (!triple && (code === 10 || code === 13)) this.fail('Line breaks are not allowed in literals');
      value += this.input[this.index]!;
      this.advanceOne();
    }
    this.fail('Unterminated literal');
  }

  private readEscape(): string {
    const code = this.peekCharCode();
    if (code === 116) { this.index++; return '\t'; }
    if (code === 98) { this.index++; return '\b'; }
    if (code === 110) { this.index++; return '\n'; }
    if (code === 114) { this.index++; return '\r'; }
    if (code === 102) { this.index++; return '\f'; }
    if (code === 34 || code === 39 || code === 92) { this.index++; return String.fromCharCode(code); }
    if (code === 117 || code === 85) {
      const size = code === 117 ? 4 : 8;
      this.index++;
      const hex = this.input.slice(this.index, this.index + size);
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== size) this.fail('Invalid Unicode escape');
      this.index += size;
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    this.fail('Invalid escape sequence');
  }

  private readLanguageTag(): string {
    const start = this.index;
    const first = this.peekCharCode();
    if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) this.fail('Expected language tag');
    while (this.index < this.length) {
      const code = this.peekCharCode();
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45) {
        this.index++;
      } else {
        break;
      }
    }
    if (this.index === start) this.fail('Expected language tag');
    const tag = this.input.slice(start, this.index);
    const directionalSeparator = tag.indexOf('--');
    const language = directionalSeparator >= 0 ? tag.slice(0, directionalSeparator) : tag;
    const direction = directionalSeparator >= 0 ? tag.slice(directionalSeparator + 2) : '';
    if (!language) this.fail('Expected language tag');
    for (const subtag of language.split('-')) {
      if (!subtag || subtag.length > 8) this.fail('Invalid language tag');
    }
    if (directionalSeparator >= 0 && direction !== 'ltr' && direction !== 'rtl') {
      this.fail('Invalid base direction');
    }
    return tag.toLowerCase();
  }

  private readUntilColon(): string {
    const start = this.index;
    while (this.index < this.length) {
      const code = this.peekCharCode();
      if (code === 58) break;
      if (!isPrefixNameChar(code)) break;
      this.index++;
    }
    return this.input.slice(start, this.index);
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
          if (next === 10 || next === 13) break;
          this.index++;
        }
        this.callbacks.comment?.(this.input.slice(start, this.index));
        continue;
      }
      return;
    }
  }

  private matchWord(word: string, allowDotBoundary = false): boolean {
    if (this.input.length - this.index < word.length) return false;
    if (this.input.slice(this.index, this.index + word.length).toLowerCase() !== word.toLowerCase()) return false;
    const previous = this.index > 0 ? this.input.charCodeAt(this.index - 1) : -1;
    const next = this.input.charCodeAt(this.index + word.length);
    if ((previous >= 0 && isWordBoundaryBlocker(previous)) || (isWordBoundaryBlocker(next) && !(allowDotBoundary && next === 46))) return false;
    this.index += word.length;
    return true;
  }

  private canStartTerm(): boolean {
    const code = this.peekCharCode();
    return code === 60 || code === 95 || code === 91 || code === 40 || code === 34 || code === 39 || code === 43 || code === 45 ||
      (code >= 48 && code <= 57) || isPrefixStart(code);
  }

  private nextIsStatementBoundary(): boolean {
    const code = this.peekCharCode();
    return code === 46 || code === 59 || code === 44 || code === 125 || code === 93 || code === 41 || code < 0;
  }

  private expectChar(code: number, message: string): void {
    this.skipWsAndComments();
    if (this.peekCharCode() !== code) this.fail(message);
    this.index++;
  }

  private peekCharCode(): number {
    return this.index < this.length ? this.input.charCodeAt(this.index) : -1;
  }

  private advanceOne(): void {
    if (this.input.charCodeAt(this.index) === 10) this.line++;
    this.index++;
  }

  private fail(message: string): never {
    const error = new Error(`${message} on line ${this.line}.`);
    (error as Error & { context?: unknown }).context = { line: this.line, index: this.index };
    throw error;
  }
}

function resolveIri(value: string, baseIRI: string): string {
  if (!baseIRI || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return value;
  try {
    return new URL(value, baseIRI).href;
  } catch {
    return value;
  }
}

function isMessagesVersion(version: string | undefined): boolean {
  return typeof version === 'string' && version.toLowerCase().endsWith('-messages');
}

function isWs(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function isInvalidIriChar(code: number): boolean {
  return code <= 32 || code === 34 || code === 60 || code === 62 || code === 94 || code === 96 || code === 123 || code === 124 || code === 125;
}

function isNameChar(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) ||
    code === 95 || code === 45 || code === 46;
}

function isWordBoundaryBlocker(code: number): boolean {
  return isNameChar(code) || code === 58;
}

function isPrefixStart(code: number): boolean {
  return code === 58 || code === 95 || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isPrefixNameChar(code: number): boolean {
  return code === 95 || code === 45 || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

function isLocalNameChar(code: number): boolean {
  return isPrefixNameChar(code) || code === 126 || code === 46 || code === 37 || code === 47 || code === 35;
}

function isLanguageTagValid(tag: string): boolean {
  const directionalSeparator = tag.indexOf('--');
  const language = directionalSeparator >= 0 ? tag.slice(0, directionalSeparator) : tag;
  const direction = directionalSeparator >= 0 ? tag.slice(directionalSeparator + 2) : '';
  if (!language) return false;
  const first = language.charCodeAt(0);
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) return false;
  for (const subtag of language.split('-')) {
    if (!subtag || subtag.length > 8) return false;
  }
  return directionalSeparator < 0 || direction === 'ltr' || direction === 'rtl';
}

function escapeString(value: string): string {
  return value.replace(/[\\"\n\r\t\b\f]/g, character => {
    switch (character) {
      case '\\': return '\\\\';
      case '"': return '\\"';
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\t': return '\\t';
      case '\b': return '\\b';
      case '\f': return '\\f';
      default: return character;
    }
  });
}

export function termToString(term: TermLike): string {
  switch (term.termType) {
    case 'NamedNode':
      return `<${term.value.replace(/[>\\]/g, character => `\\${character}`)}>`;
    case 'BlankNode':
      return `_:${term.value}`;
    case 'Variable':
      return `?${term.value}`;
    case 'DefaultGraph':
      return '';
    case 'Literal': {
      const quoted = `"${escapeString(term.value)}"`;
      if (term.language) return `${quoted}@${term.direction ? `${term.language}--${term.direction}` : term.language}`;
      if (term.datatype.value === XSD_STRING) return quoted;
      return `${quoted}^^<${term.datatype.value}>`;
    }
    case 'Quad':
      return `<<(${termToString(term.subject)} ${termToString(term.predicate)} ${termToString(term.object)})>>`;
  }
}

export function quadToString(quad: QuadLike): string {
  const graph = quad.graph.termType === 'DefaultGraph' ? '' : ` ${termToString(quad.graph)}`;
  return `${termToString(quad.subject)} ${termToString(quad.predicate)} ${termToString(quad.object)}${graph} .`;
}

export function termToId(term: TermLike): string {
  return termToString(term);
}

export function termFromId(id: string): TermLike {
  const parser = new CoreParser(`_:s <urn:p> ${id} .`, {}, {});
  const quad = parser.parse().quads[0];
  if (!quad) throw new Error(`Invalid term id: ${id}`);
  return quad.object;
}

export function isMessageQuad(value: unknown): value is MessageQuad {
  return Boolean(value && typeof value === 'object' && 'quad' in value && 'messageCounter' in value);
}

export function toMessages(output: Iterable<ParserOutputItem>, messageCount?: number): Message[] {
  const messages: Message[] = [];
  const parsedMessageCount = messageCount ?? getMessageCount(output);
  let sawMessageCounters = false;

  for (const item of output) {
    const entry = isMessageQuad(item) ? item : { quad: item, messageCounter: 0 };
    sawMessageCounters ||= isMessageQuad(item);
    while (messages.length <= entry.messageCounter) messages.push(new Message(messages.length));
    messages[entry.messageCounter]!.push(entry.quad);
  }

  if (parsedMessageCount !== undefined) {
    while (messages.length < parsedMessageCount) messages.push(new Message(messages.length));
  } else if (!sawMessageCounters && messages.length === 0) {
    return [];
  }

  return messages;
}

function getMessageCount(output: Iterable<ParserOutputItem>): number | undefined {
  if (!Array.isArray(output) || !('messageCount' in output)) return undefined;
  const value = (output as Partial<MessageQuadArray>).messageCount;
  return typeof value === 'number' ? value : undefined;
}

export const namedNode = DataFactory.namedNode;
export const blankNode = DataFactory.blankNode;
export const literal = DataFactory.literal;
export const variable = DataFactory.variable;
export const defaultGraph = DataFactory.defaultGraph;
export const quad = DataFactory.quad;
