import type * as RDF from '@rdfjs/types';
import { IncrementalParser, isMessageQuad } from './index';
import type { ParserOptions, ParserOutputItem } from './index';

export {
  IncrementalParser,
  Message,
  Parser,
  isMessageQuad,
  toMessages,
} from './index';

export type {
  MessageQuad,
  MessageQuadArray,
  ParseCallback,
  ParserEventCallbacks,
  ParserOptions,
  ParserOutput,
  ParserOutputItem,
} from './index';

type BrowserStreamChunk = string | Uint8Array | ArrayBuffer;
type BrowserStreamEvent = 'prefix' | 'comment' | 'messageCounter';
type BrowserStreamListener = (...args: any[]) => void;

export type StreamParserOptions = ParserOptions;

/**
 * Web Streams counterpart of the Node.js `StreamParser`: a `TransformStream`-like object that can be passed to
 * `pipeThrough()`. It wraps an {@link IncrementalParser} and emits `prefix`, `comment` and `messageCounter` events.
 */
export class StreamParser {
  public readonly readable: ReadableStream<ParserOutputItem>;
  public readonly writable: WritableStream<BrowserStreamChunk>;

  private readonly decoder = new TextDecoder();
  private readonly parser: IncrementalParser;
  private readonly listeners: Partial<Record<BrowserStreamEvent, BrowserStreamListener[]>> = {};

  public constructor(options: StreamParserOptions = {}) {
    this.parser = new IncrementalParser(options, {
      prefix: (prefix, iri) => this.emit('prefix', prefix, iri),
      comment: comment => this.emit('comment', comment),
    });

    const transform = new TransformStream<BrowserStreamChunk, ParserOutputItem>({
      transform: (chunk, controller) => {
        this.enqueue(this.parser.write(this.decode(chunk)), controller);
      },
      flush: (controller) => {
        this.enqueue(this.parser.end(this.decoder.decode()), controller);
      },
    });
    this.readable = transform.readable;
    this.writable = transform.writable;
  }

  public import(stream: ReadableStream<BrowserStreamChunk>): ReadableStream<ParserOutputItem> {
    return stream.pipeThrough(this);
  }

  public on(event: BrowserStreamEvent, listener: BrowserStreamListener): this {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }

  public addEventListener(event: BrowserStreamEvent, listener: BrowserStreamListener): this {
    return this.on(event, listener);
  }

  private decode(chunk: BrowserStreamChunk): string {
    if (typeof chunk === 'string') {
      return chunk;
    }
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    return this.decoder.decode(bytes, { stream: true });
  }

  private enqueue(items: ParserOutputItem[], controller: TransformStreamDefaultController<ParserOutputItem>): void {
    for (const item of items) {
      if (isMessageQuad(item)) {
        this.emit('messageCounter', item.messageCounter, item.quad);
      }
      controller.enqueue(item);
    }
  }

  private emit(event: 'prefix', prefix: string, iri: RDF.NamedNode): void;
  private emit(event: 'comment', comment: string): void;
  private emit(event: 'messageCounter', counter: number, quad: RDF.BaseQuad): void;
  private emit(event: BrowserStreamEvent, ...args: unknown[]): void {
    for (const listener of this.listeners[event] ?? []) {
      listener(...args);
    }
  }
}
