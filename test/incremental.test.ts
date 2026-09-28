import { Readable } from 'node:stream';
import type * as RDF from '@rdfjs/types';
import { describe, expect, it } from 'vitest';
import { DataFactory, IncrementalParser, StreamParser, isMessageQuad, type ParserOutputItem } from '../src';
import { StreamParser as BrowserStreamParser } from '../src/browser';
import { quadToString } from '../src/serialize';

/** Throws a value that is not an `Error`, as a misbehaving data factory could. */
function throwValue(value: unknown): never {
  throw value;
}

const EX = 'http://example.org/';

function strings(items: ParserOutputItem[]): string[] {
  return items.map(item => quadToString(isMessageQuad(item) ? item.quad : item));
}

/** Writes each chunk and records how many quads were emitted after each write and after the end. */
function counts(chunks: string[]): { counts: number[]; quads: string[] } {
  const parser = new IncrementalParser({ baseIRI: EX });
  const quads: string[] = [];
  const result: number[] = [];
  for (const chunk of chunks) {
    quads.push(...strings(parser.write(chunk)));
    result.push(quads.length);
  }
  quads.push(...strings(parser.end()));
  result.push(quads.length);
  return { counts: result, quads };
}

describe('IncrementalParser', () => {
  it('strips a byte order mark from the first chunk only', () => {
    const parser = new IncrementalParser({ baseIRI: EX });
    expect(parser.write('')).toEqual([]);
    expect(strings(parser.write('\uFEFF<s> <p> "\uFEFF" . '))).toEqual([ `<${EX}s> <${EX}p> "\uFEFF" .` ]);
    expect(strings(parser.end('<s> <p> <o> .'))).toEqual([ `<${EX}s> <${EX}p> <${EX}o> .` ]);
  });

  it('waits for comments to end', () => {
    expect(counts([ '# a comment', '\n<s> <p> <o> .', ' ' ]).counts).toEqual([ 0, 0, 1, 1 ]);
    expect(counts([ '<s> <p> <o> . # trailing', '\r\n<s> <p> <o2> .\r', '<s> <p> <o3> . #x\r', ' ' ]).counts)
      .toEqual([ 1, 2, 3, 3, 3 ]);
    expect(counts([ '<s> <p> <o> .#x\n' ]).counts).toEqual([ 1, 1 ]);
  });

  it('waits for literals to end', () => {
    expect(counts([ '<s> <p> "a . ', 'b" . ' ]).counts).toEqual([ 0, 1, 1 ]);
    expect(counts([ String.raw`<s> <p> "a\"`, '. " . ' ]).counts).toEqual([ 0, 1, 1 ]);
    expect(counts([ '<s> <p> "a\\', '" . " . ' ]).counts).toEqual([ 0, 1, 1 ]);
    expect(counts([ `<s> <p> """a " . ""`, `. """ . ` ]).counts).toEqual([ 0, 1, 1 ]);
    expect(counts([ `<s> <p> '' . ` ]).counts).toEqual([ 1, 1 ]);
  });

  it('waits for IRIs to end', () => {
    const result = counts([ '<s> <p> <o.#x', '> . ', String.raw`<s> <p> <\u0041> . `, '<s> <p> <\\', 'u0042> . ' ]);
    expect(result.counts).toEqual([ 0, 1, 2, 2, 3, 3 ]);
    expect(result.quads).toEqual([
      `<${EX}s> <${EX}p> <${EX}o.#x> .`,
      `<${EX}s> <${EX}p> <${EX}A> .`,
      `<${EX}s> <${EX}p> <${EX}B> .`,
    ]);
  });

  it('waits for graph blocks, property lists and collections to close', () => {
    expect(counts([ '<g> { <s> <p> <o> . ', '} . ' ]).counts).toEqual([ 0, 1, 1 ]);
    expect(counts([ '<g> { <s> <p> <o> . } ' ]).counts).toEqual([ 0, 1 ]);
    for (const open of [ '[ <q> <r>', '( <a>' ]) {
      const parser = new IncrementalParser({});
      expect(parser.write(`<s> <p> ${open} . `)).toEqual([]);
      expect(() => parser.end()).toThrow();
    }
    expect(counts([ '<s> <p> [ <q> <r> ] . ', '<s> <p> ( <a> ) . ' ]).counts).toEqual([ 2, 5, 5 ]);
    expect(counts([ '<< <s> <p> <o> >> <q> <r> . ' ]).counts).toEqual([ 2, 2 ]);
  });

  it('does not split on dots inside names', () => {
    const parser = new IncrementalParser({});
    expect(parser.write(`@prefix ex: <${EX}> . ex:s ex:p ex:a.b`)).toEqual([]);
    expect(strings(parser.end(' .'))).toEqual([ `<${EX}s> <${EX}p> <${EX}a.b> .` ]);
  });

  it('does not track stray closing brackets', () => {
    const parser = new IncrementalParser({});
    expect(() => parser.write('} ] ) . ')).toThrow(/Expected prefixed name/u);
  });
});

async function collectNode(parser: StreamParser): Promise<unknown[]> {
  const output: unknown[] = [];
  return await new Promise<unknown[]>((resolve, reject) => {
    parser.on('data', item => output.push(item));
    parser.on('error', reject);
    parser.on('end', () => resolve(output));
  });
}

describe('Node.js StreamParser', () => {
  it('accepts string chunks when strings are not decoded to buffers', async() => {
    const parser = new StreamParser({ baseIRI: EX, decodeStrings: false });
    const done = collectNode(parser);
    parser.write('<s> <p> <o> . ');
    parser.end('<s> <p> <o2> .');
    expect((await done).map(quad => quadToString(<RDF.BaseQuad>quad))).toEqual([
      `<${EX}s> <${EX}p> <${EX}o> .`,
      `<${EX}s> <${EX}p> <${EX}o2> .`,
    ]);
  });

  it('emits message counters in RDF Messages mode', async() => {
    const parser = new StreamParser({ baseIRI: EX, rdfMessages: true });
    const counters: number[] = [];
    parser.on('messageCounter', (counter: number) => counters.push(counter));
    const done = collectNode(parser.import(Readable.from([ '<s> <p> <o> .\nMESSAGE\n', '<s> <p> <o2> .' ])));
    const output = await done;
    expect(counters).toEqual([ 0, 1 ]);
    expect(output.every(isMessageQuad)).toBe(true);
  });

  it('emits parse errors', async() => {
    const parser = new StreamParser();
    const done = collectNode(parser);
    parser.end('<s> <p>');
    await expect(done).rejects.toThrow(/Unexpected end of input/u);
  });

  it('wraps non-Error exceptions', async() => {
    const factory = {
      ...DataFactory,
      namedNode: (): never => throwValue('factory failure'),
    };
    const parser = new StreamParser({ factory });
    const done = collectNode(parser);
    parser.end('<http://s> <http://p> <http://o> .');
    await expect(done).rejects.toThrow('factory failure');
  });

  it('forwards errors of imported streams', async() => {
    const parser = new StreamParser();
    const source = new Readable({
      read() {
        this.destroy(new Error('source failure'));
      },
    });
    const error = await new Promise<Error>((resolve) => {
      parser.on('error', resolve);
      parser.import(source);
    });
    expect(error.message).toBe('source failure');
  });
});

describe('Browser StreamParser events and chunks', () => {
  async function collect(stream: ReadableStream<unknown>): Promise<unknown[]> {
    const output: unknown[] = [];
    const reader = stream.getReader();
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return output;
      }
      output.push(result.value);
    }
  }

  it('decodes ArrayBuffer chunks and emits comment events', async() => {
    const comments: string[] = [];
    const parser = new BrowserStreamParser({ baseIRI: EX, comments: true });
    parser.on('comment', comment => comments.push(comment));
    const bytes = new TextEncoder().encode(`# hello\n@prefix ex: <${EX}> . ex:s ex:p ex:o .`);
    const stream = new ReadableStream<ArrayBuffer>({
      start(controller) {
        controller.enqueue(bytes.buffer);
        controller.close();
      },
    });
    const output = await collect(parser.import(stream));
    expect(comments).toEqual([ ' hello' ]);
    expect(output.map(quad => quadToString(<RDF.BaseQuad>quad))).toEqual([ `<${EX}s> <${EX}p> <${EX}o> .` ]);
  });
});
