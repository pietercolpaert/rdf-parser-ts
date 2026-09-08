import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DataFactory, Parser, StreamParser, isMessageQuad, quadToString, termFromId, termToString, type MessageQuad, type QuadLike } from '../src';
import { StreamParser as BrowserStreamParser } from '../src/browser';

function ids(input: string, baseIRI = 'http://example.org/'): string[] {
  return ((new Parser({ baseIRI }).parse(input) ?? []) as QuadLike[]).map(quadToString);
}

async function writeChunk(parser: StreamParser, chunk: string | Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    parser.write(chunk, error => error ? reject(error) : resolve());
  });
}

describe('Parser', () => {
  it('exports an N3-compatible parser constructor', () => {
    expect(Parser).toBeInstanceOf(Function);
    expect(new Parser()).toBeInstanceOf(Parser);
  });

  it('parses an empty document', () => {
    expect(ids(' \t\n # comment')).toEqual([]);
  });

  it('parses N-Triples and resolves relative IRIs against baseIRI', () => {
    expect(ids('<a> <b> <c>.')).toEqual([
      '<http://example.org/a> <http://example.org/b> <http://example.org/c> .',
    ]);
  });

  it('parses N-Quads', () => {
    expect(ids('<s> <p> "value" <g> .')).toEqual([
      '<http://example.org/s> <http://example.org/p> "value" <http://example.org/g> .',
    ]);
  });

  it('rejects invalid characters in Turtle IRIs', () => {
    const parser = new Parser();
    expect(() => parser.parse(String.raw`<http://example.org/\u0020> <p> <o> .`)).toThrow('Invalid character in IRI');
    expect(() => parser.parse(String.raw`<http://example.org/\u003C> <p> <o> .`)).toThrow('Invalid character in IRI');
    expect(() => parser.parse(String.raw`<http://example.org/\u003E> <p> <o> .`)).toThrow('Invalid character in IRI');
    expect(() => parser.parse('<http://example.org/{abc}> <p> <o> .')).toThrow('Invalid character in IRI');
  });

  it('parses Turtle prefixes, literals, booleans, and numeric terms', () => {
    expect(ids('@prefix ex: <http://example.com/>. ex:s ex:p "hello"@EN; ex:n 42, 1.25, 1e2; a ex:T; ex:b true .')).toEqual([
      '<http://example.com/s> <http://example.com/p> "hello"@en .',
      '<http://example.com/s> <http://example.com/n> "42"^^<http://www.w3.org/2001/XMLSchema#integer> .',
      '<http://example.com/s> <http://example.com/n> "1.25"^^<http://www.w3.org/2001/XMLSchema#decimal> .',
      '<http://example.com/s> <http://example.com/n> "1e2"^^<http://www.w3.org/2001/XMLSchema#double> .',
      '<http://example.com/s> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.com/T> .',
      '<http://example.com/s> <http://example.com/b> "true"^^<http://www.w3.org/2001/XMLSchema#boolean> .',
    ]);
  });

  it('parses boolean literals followed by Turtle punctuation', () => {
    expect(ids('@prefix ex: <http://example.com/>. ex:s ex:enabled true.')).toEqual([
      '<http://example.com/s> <http://example.com/enabled> "true"^^<http://www.w3.org/2001/XMLSchema#boolean> .',
    ]);
    expect(ids('@prefix ex: <http://example.com/>. ex:s ex:enabled true; ex:disabled false.')).toEqual([
      '<http://example.com/s> <http://example.com/enabled> "true"^^<http://www.w3.org/2001/XMLSchema#boolean> .',
      '<http://example.com/s> <http://example.com/disabled> "false"^^<http://www.w3.org/2001/XMLSchema#boolean> .',
    ]);
  });

  it('parses integer literals followed by a Turtle dot terminator', () => {
    expect(ids('@prefix ex: <http://example.com/>. ex:s ex:count 60.')).toEqual([
      '<http://example.com/s> <http://example.com/count> "60"^^<http://www.w3.org/2001/XMLSchema#integer> .',
    ]);
  });

  it('parses double literals with a dot and no fractional digits', () => {
    expect(ids('@prefix ex: <http://example.com/>. ex:s ex:value 123.E+1.')).toEqual([
      '<http://example.com/s> <http://example.com/value> "123.E+1"^^<http://www.w3.org/2001/XMLSchema#double> .',
    ]);
  });

  it('parses Turtle blank node property list statements', () => {
    const output = ids(`@prefix dash: <http://datashapes.org/dash#> .
@prefix ex: <http://datashapes.org/sh/tests/core/node/class-002.test#> .
@prefix mf: <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix sht: <http://www.w3.org/ns/shacl-test#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:NamedInstance
  rdf:type ex:TestClass ;
.
ex:TestShape
  rdf:type sh:NodeShape ;
  sh:class ex:TestClass ;
  sh:targetClass ex:BNodeClass ;
  sh:targetNode ex:NamedInstance ;
  sh:targetNode "String" ;
.
<>
  rdf:type mf:Manifest ;
  mf:entries (
      <class-002>
    ) ;
.
<class-002>
  rdf:type sht:Validate ;
  rdfs:label "Test of sh:class at node shape 002" ;
  mf:action [
      sht:dataGraph <> ;
      sht:shapesGraph <> ;
    ] ;
  mf:result [
      rdf:type sh:ValidationReport ;
      sh:conforms "false"^^xsd:boolean ;
      sh:result [
          rdf:type sh:ValidationResult ;
          sh:focusNode "String" ;
          sh:resultSeverity sh:Violation ;
          sh:sourceConstraintComponent sh:ClassConstraintComponent ;
          sh:sourceShape ex:TestShape ;
          sh:value "String" ;
        ] ;
      sh:result [
          rdf:type sh:ValidationResult ;
          sh:focusNode _:b9751 ;
          sh:resultSeverity sh:Violation ;
          sh:sourceConstraintComponent sh:ClassConstraintComponent ;
          sh:sourceShape ex:TestShape ;
          sh:value _:b9751 ;
        ] ;
    ] ;
  mf:status sht:approved ;
.
_:b9751
  rdf:type ex:BNodeClass ;
.
[
  rdf:type ex:BNodeClass ;
  rdf:type ex:TestClass 
].`);

    expect(output).toHaveLength(36);
    expect(output).toContain('_:b5 <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://datashapes.org/sh/tests/core/node/class-002.test#BNodeClass> .');
    expect(output).toContain('_:b5 <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://datashapes.org/sh/tests/core/node/class-002.test#TestClass> .');
  });

  it('parses TriG graph blocks', () => {
    expect(ids('@prefix ex: <http://example.com/>. ex:g { ex:s ex:p ex:o. }')).toEqual([
      '<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/g> .',
    ]);
  });

  it('allows graph blocks to end without a final triple dot', () => {
    expect(ids('@prefix ex: <http://example.com/>. ex:g { ex:s ex:p ex:o } ex:s2 ex:p ex:o.')).toEqual([
      '<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/g> .',
      '<http://example.com/s2> <http://example.com/p> <http://example.com/o> .',
    ]);
    expect(ids('@prefix ex: <http://example.com/>. { ex:s ex:p ex:o }')).toEqual([
      '<http://example.com/s> <http://example.com/p> <http://example.com/o> .',
    ]);
    expect(() => new Parser({ format: 'turtle' }).parse('{ <s> <p> <o> }')).toThrow(/Expected \./);
  });

  it('supports an RDF-JS factory override', () => {
    const quads = (new Parser({ factory: DataFactory }).parse('<s> <p> "o" .') ?? []) as QuadLike[];
    expect(quads[0]?.subject.termType).toBe('NamedNode');
    expect(quads[0]?.object.termType).toBe('Literal');
    expect(quads[0]?.graph.termType).toBe('DefaultGraph');
  });

  it('converts terms to and from ids', () => {
    const term = termFromId('"hello"@en');
    expect(term.termType).toBe('Literal');
    expect(termToString(term)).toBe('"hello"@en');
  });

  it('parses RDF1.2 triple terms and Turtle reified triples', () => {
    expect(ids('<<( <s> <p> <o> )>> <p2> <<( <s2> <p2> <o2> )>> .')).toEqual([
      '<<(<http://example.org/s> <http://example.org/p> <http://example.org/o>)>> <http://example.org/p2> <<(<http://example.org/s2> <http://example.org/p2> <http://example.org/o2>)>> .',
    ]);
    expect(ids('<< <s> <p> <o> >> <p2> <o2> .')).toEqual([
      '_:b0 <http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies> <<(<http://example.org/s> <http://example.org/p> <http://example.org/o>)>> .',
      '_:b0 <http://example.org/p2> <http://example.org/o2> .',
    ]);
    expect(() => new Parser({ format: 'N-Quads' }).parse(
      '<< <http://example.org/s> <http://example.org/p> <http://example.org/o> >> <http://example.org/p2> <http://example.org/o2> .',
    )).toThrow(/Reified triples are not allowed/);
  });
});

describe('StreamParser', () => {
  it('exports an N3-compatible stream parser constructor', () => {
    expect(StreamParser).toBeInstanceOf(Function);
    expect(new StreamParser()).toBeInstanceOf(StreamParser);
  });

  it('parses chunked streams', async () => {
    const parser = new StreamParser({ baseIRI: 'http://example.org/' });
    const input = Readable.from(['<a> <b>', ' <c>.\n', '<d> <e> <f>.']);
    const output: string[] = [];
    const sink = new Writable({
      objectMode: true,
      write(quad, _encoding, callback) {
        output.push(quadToString(quad));
        callback();
      },
    });

    await new Promise<void>((resolve, reject) => {
      parser.on('error', reject);
      sink.on('error', reject);
      sink.on('finish', resolve);
      parser.import(input).pipe(sink);
    });

    expect(output).toEqual([
      '<http://example.org/a> <http://example.org/b> <http://example.org/c> .',
      '<http://example.org/d> <http://example.org/e> <http://example.org/f> .',
    ]);
  });

  it('emits complete statements before the stream ends', async () => {
    const parser = new StreamParser({ baseIRI: 'http://example.org/' });
    const output: string[] = [];
    parser.on('data', quad => output.push(quadToString(quad)));

    await writeChunk(parser, '<a> <b> <c>. ');
    expect(output).toEqual(['<http://example.org/a> <http://example.org/b> <http://example.org/c> .']);

    await writeChunk(parser, '<d> <e>');
    expect(output).toEqual(['<http://example.org/a> <http://example.org/b> <http://example.org/c> .']);

    await writeChunk(parser, ' <f>. ');
    expect(output).toEqual([
      '<http://example.org/a> <http://example.org/b> <http://example.org/c> .',
      '<http://example.org/d> <http://example.org/e> <http://example.org/f> .',
    ]);

    await new Promise<void>((resolve, reject) => {
      parser.on('error', reject);
      parser.on('end', resolve);
      parser.end();
    });
  });

  it('preserves parser state across incremental stream parses', async () => {
    const parser = new StreamParser();
    const prefixes: string[] = [];
    const output: string[] = [];
    parser.on('prefix', prefix => prefixes.push(prefix));
    parser.on('data', quad => output.push(quadToString(quad)));

    await writeChunk(parser, '@prefix ex: <http://example.com/>. ');
    expect(prefixes).toEqual(['ex']);
    expect(output).toEqual([]);

    await writeChunk(parser, 'ex:s ex:p ex:o. ');
    expect(output).toEqual(['<http://example.com/s> <http://example.com/p> <http://example.com/o> .']);

    await new Promise<void>((resolve, reject) => {
      parser.on('error', reject);
      parser.on('end', resolve);
      parser.end();
    });
  });

  it('decodes UTF-8 characters split across chunks', async () => {
    const parser = new StreamParser({ baseIRI: 'http://example.org/' });
    const output: string[] = [];
    const input = Buffer.from('<s> <p> "café". ', 'utf8');
    const split = input.indexOf(0xC3) + 1;
    parser.on('data', quad => output.push(quadToString(quad)));

    await writeChunk(parser, input.subarray(0, split));
    expect(output).toEqual([]);
    await writeChunk(parser, input.subarray(split));
    expect(output).toEqual(['<http://example.org/s> <http://example.org/p> "café" .']);

    await new Promise<void>((resolve, reject) => {
      parser.on('error', reject);
      parser.on('end', resolve);
      parser.end();
    });
  });

  it('emits prefix and comment events', async () => {
    const prefixes: string[] = [];
    const comments: string[] = [];
    const parser = new StreamParser({ comments: true });
    parser.on('prefix', prefix => prefixes.push(prefix));
    parser.on('comment', comment => comments.push(comment));

    await new Promise<void>((resolve, reject) => {
      parser.on('data', () => undefined);
      parser.on('error', reject);
      parser.on('end', resolve);
      parser.import(Readable.from(['# hi\n@prefix ex: <http://example.com/>. ex:s ex:p ex:o.']));
    });

    expect(prefixes).toEqual(['ex']);
    expect(comments).toEqual([' hi']);
  });
});

describe('Browser StreamParser', () => {
  async function collect(stream: ReadableStream<unknown>): Promise<unknown[]> {
    const output: unknown[] = [];
    const reader = stream.getReader();
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      output.push(result.value);
    }
    return output;
  }

  it('parses Web Streams incrementally', async () => {
    const parser = new BrowserStreamParser({ baseIRI: 'http://example.org/' });
    const input = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('<a> <b>');
        controller.enqueue(' <c>.\n');
        controller.enqueue('<d> <e> <f>.');
        controller.close();
      },
    });

    const output = await collect(parser.import(input));
    expect(output.map(quad => quadToString(quad as QuadLike))).toEqual([
      '<http://example.org/a> <http://example.org/b> <http://example.org/c> .',
      '<http://example.org/d> <http://example.org/e> <http://example.org/f> .',
    ]);
  });

  it('preserves prefixes and decodes split UTF-8 byte chunks', async () => {
    const prefixes: string[] = [];
    const parser = new BrowserStreamParser({ baseIRI: 'http://example.org/' });
    parser.on('prefix', prefix => prefixes.push(prefix));

    const input = new TextEncoder().encode('@prefix ex: <http://example.com/>. ex:s ex:p "café".');
    const split = input.indexOf(0xC3) + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(input.subarray(0, split));
        controller.enqueue(input.subarray(split));
        controller.close();
      },
    });

    const output = await collect(parser.import(stream));
    expect(prefixes).toEqual(['ex']);
    expect(output.map(quad => quadToString(quad as QuadLike))).toEqual([
      '<http://example.com/s> <http://example.com/p> "café" .',
    ]);
  });

  it('emits message counters in browser Web Streams', async () => {
    const counters: number[] = [];
    const parser = new BrowserStreamParser({ baseIRI: 'http://example.org/' });
    parser.addEventListener('messageCounter', counter => counters.push(counter));
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('VERSION "1.2-messages"\n<s1> <p> <o1> .\n');
        controller.enqueue('MESSAGE\n<s2> <p> <o2> .');
        controller.close();
      },
    });

    const output = await collect(parser.import(stream));
    expect(counters).toEqual([0, 1]);
    expect(output.every(isMessageQuad)).toBe(true);
    expect((output as MessageQuad[]).map(entry => quadToString(entry.quad))).toEqual([
      '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .',
      '<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .',
    ]);
  });
});
