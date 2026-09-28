import type * as RDF from '@rdfjs/types';
import { describe, expect, it } from 'vitest';
import { DataFactory, Parser, type MessageQuad, type ParserOptions } from '../src';
import { quadToString } from '../src/serialize';

/** Throws a value that is not an `Error`, as a misbehaving data factory could. */
function throwValue(value: unknown): never {
  throw value;
}

const EX = 'http://example.org/';
const PREFIX = `@prefix ex: <${EX}> .\n`;
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

function ids(input: string, options: ParserOptions = {}): string[] {
  return (<RDF.BaseQuad[]> new Parser({ baseIRI: EX, ...options }).parse(input)).map(quadToString);
}

describe('Turtle and TriG syntax', () => {
  it('parses BASE and @base directives', () => {
    expect(ids('@base <http://other.org/> . <a> <b> <c> .\nBASE <http://third.org/dir/>\n<a> <b> <../c> .')).toEqual([
      '<http://other.org/a> <http://other.org/b> <http://other.org/c> .',
      '<http://third.org/dir/a> <http://third.org/dir/b> <http://third.org/c> .',
    ]);
    expect(() => ids('@base <http://other.org/> <a> <b> <c> .')).toThrow(/Expected \. after base directive/u);
  });

  it('keeps relative IRIs when the base IRI cannot be used for resolution', () => {
    expect(ids('<a> <b> <c> .', { baseIRI: 'no-scheme' })).toEqual([ '<a> <b> <c> .' ]);
  });

  it('parses the SPARQL-style PREFIX and VERSION directives', () => {
    expect(ids(`VERSION "1.2"\nPREFIX ex: <${EX}>\nex:s ex:p ex:o .`)).toEqual([
      `<${EX}s> <${EX}p> <${EX}o> .`,
    ]);
    expect(ids(`@prefix ex : <${EX}> . ex:s ex:p ex:o .`)).toEqual([ `<${EX}s> <${EX}p> <${EX}o> .` ]);
  });

  it('parses literals with quotes, escapes and long forms', () => {
    expect(ids(String.raw`<s> <p> "", '', """a"b""c""", '''x'y''', "\t\b\n\r\f\"\'\\A\U0001F600" .`)).toEqual([
      `<${EX}s> <${EX}p> "" .`,
      `<${EX}s> <${EX}p> "" .`,
      String.raw`<${EX}s> <${EX}p> "a\"b\"\"c" .`,
      `<${EX}s> <${EX}p> "x'y" .`,
      `<${EX}s> <${EX}p> "\\t\\b\\n\\r\\f\\"'\\\\A\u{1F600}" .`,
    ]);
    expect(ids('<s> <p> """line\nbreak""" .')).toEqual([ String.raw`<${EX}s> <${EX}p> "line\nbreak" .` ]);
    expect(ids(`${PREFIX}<s> <p> "a"^^ex:dt .`)).toEqual([ `<${EX}s> <${EX}p> "a"^^<${EX}dt> .` ]);
  });

  it('parses IRI escapes', () => {
    expect(ids(String.raw`<s> <p> <http://example.org/A\U00000042> .`)).toEqual([
      `<${EX}s> <${EX}p> <${EX}AB> .`,
    ]);
  });

  it('parses numbers', () => {
    expect(ids('<s> <p> +1, -2.5, +.5, 5.e1 .')).toEqual([
      `<${EX}s> <${EX}p> "+1"^^<http://www.w3.org/2001/XMLSchema#integer> .`,
      `<${EX}s> <${EX}p> "-2.5"^^<http://www.w3.org/2001/XMLSchema#decimal> .`,
      `<${EX}s> <${EX}p> "+.5"^^<http://www.w3.org/2001/XMLSchema#decimal> .`,
      `<${EX}s> <${EX}p> "5.e1"^^<http://www.w3.org/2001/XMLSchema#double> .`,
    ]);
  });

  it('parses blank nodes, property lists and collections', () => {
    expect(ids(`${PREFIX}_:a.b ex:p [], [ ex:q ex:r ], (), (ex:x ex:y) .
[ ex:p ex:o ] ex:q ex:r .
[ ex:p ex:o ] .`)).toEqual([
      `_:a.b <${EX}p> _:b0 .`,
      `_:b1 <${EX}q> <${EX}r> .`,
      `_:a.b <${EX}p> _:b1 .`,
      `_:a.b <${EX}p> <${RDF_NS}nil> .`,
      `_:b2 <${RDF_NS}first> <${EX}x> .`,
      `_:b2 <${RDF_NS}rest> _:b3 .`,
      `_:b3 <${RDF_NS}first> <${EX}y> .`,
      `_:b3 <${RDF_NS}rest> <${RDF_NS}nil> .`,
      `_:a.b <${EX}p> _:b2 .`,
      `_:b4 <${EX}p> <${EX}o> .`,
      `_:b4 <${EX}q> <${EX}r> .`,
      `_:b5 <${EX}p> <${EX}o> .`,
    ]);
  });

  it('treats a dot before punctuation as the end of a name', () => {
    expect(() => ids(`${PREFIX}ex:s ex:p (ex:b.) .`)).toThrow(/Expected prefixed name/u);
    expect(ids(`${PREFIX}ex:s ex:p ex:a.b, _:c.d .`)).toEqual([
      `<${EX}s> <${EX}p> <${EX}a.b> .`,
      `<${EX}s> <${EX}p> _:c.d .`,
    ]);
    expect(ids('<s> <p> _:o.')).toEqual([ `<${EX}s> <${EX}p> _:o .` ]);
  });

  it('distinguishes keywords from prefixed names', () => {
    expect(ids(`@prefix a: <${EX}a#> . @prefix truex: <${EX}t#> . @prefix e: <${EX}e#> .
<s> a:b truex:y .
<s> <p> e:.`)).toEqual([
      `<${EX}s> <${EX}a#b> <${EX}t#y> .`,
      `<${EX}s> <${EX}p> <${EX}e#> .`,
    ]);
  });

  it('parses TriG graphs with GRAPH, anonymous and trailing-dot forms', () => {
    expect(ids(`${PREFIX}GRAPH ex:g { ex:s ex:p ex:o . } .
[] { ex:s ex:p ex:o }
[ # empty
] { ex:s ex:p ex:o ; }
{ [ ex:p ex:o ] }
ex:s ex:p ex:o ex:g2 .
ex:s ex:p ex:o _:g3 .`)).toEqual([
      `<${EX}s> <${EX}p> <${EX}o> <${EX}g> .`,
      `<${EX}s> <${EX}p> <${EX}o> _:b0 .`,
      `<${EX}s> <${EX}p> <${EX}o> _:b1 .`,
      `_:b2 <${EX}p> <${EX}o> .`,
      `<${EX}s> <${EX}p> <${EX}o> <${EX}g2> .`,
      `<${EX}s> <${EX}p> <${EX}o> _:g3 .`,
    ]);
  });

  it('parses reified triples with and without reifiers', () => {
    expect(ids(`${PREFIX}<< ex:s ex:p ex:o ~ ex:r >> ex:q ex:z .
<< ex:s ex:p ex:o ~ >> ex:q ex:z .
<< [] ex:p [] ~ _:r >> ex:q ex:z .
<< ex:s ex:p <<( ex:a ex:b ex:c )>> ~ [] >> ex:q ex:z .`)).toEqual([
      `<${EX}r> <${RDF_NS}reifies> <<(<${EX}s> <${EX}p> <${EX}o>)>> .`,
      `<${EX}r> <${EX}q> <${EX}z> .`,
      `_:b0 <${RDF_NS}reifies> <<(<${EX}s> <${EX}p> <${EX}o>)>> .`,
      `_:b0 <${EX}q> <${EX}z> .`,
      `_:r <${RDF_NS}reifies> <<(_:b1 <${EX}p> _:b2)>> .`,
      `_:r <${EX}q> <${EX}z> .`,
      `_:b3 <${RDF_NS}reifies> <<(<${EX}s> <${EX}p> <<(<${EX}a> <${EX}b> <${EX}c>)>>)>> .`,
      `_:b3 <${EX}q> <${EX}z> .`,
    ]);
  });

  it('rejects invalid Turtle and TriG', () => {
    const cases: [string, RegExp][] = [
      [ '<s> <p>', /Unexpected end of input/u ],
      [ '"s" <p> <o> .', /Invalid subject term Literal/u ],
      [ '<s> "p" <o> .', /Invalid predicate term Literal/u ],
      [ '<s> <p> <o> "g" .', /Invalid graph term Literal/u ],
      [ '<s> <p> <o', /Unterminated IRI/u ],
      [ '<s> <p> "o', /Unterminated literal/u ],
      [ '<s> <p> "o\n" .', /Line breaks are not allowed/u ],
      [ String.raw`<s> <p> "\x" .`, /Invalid escape sequence/u ],
      [ String.raw`<s> <p> "\u12" .`, /Invalid Unicode escape/u ],
      [ String.raw`<s> <p> "\u12G4" .`, /Invalid Unicode escape/u ],
      [ '<s> <p> "o"^^_:dt .', /Expected datatype IRI/u ],
      [ '<s> <p> _: .', /Expected blank node label/u ],
      [ '<s> <p> +a .', /Invalid number/u ],
      [ '<s> <p> ex:o .', /Unknown prefix "ex"/u ],
      [ '@foo <s> <p> <o> .', /Expected prefixed name/u ],
      [ '<s> <p> <o>.BASE <http://a/> .', /Expected prefixed name/u ],
      [ '@prefix ex <http://a/> .', /Expected : after prefix label/u ],
      [ '<s> <p> [ <q> <r> . ] .', /Expected \] after property list/u ],
      [ '<s> <p> <o> ;', /Unexpected end of input/u ],
      [ '{ <s> <p> <o> .', /Unclosed graph block/u ],
      [ '{ <s> <p> <o> } .', /Expected \. after triple/u ],
      [ '{ { } }', /Graph blocks are not allowed inside graph blocks/u ],
      [ '{ GRAPH <g> { } }', /Graph blocks are not allowed inside graph blocks/u ],
      [ '{ <g> { } }', /Graph blocks are not allowed inside graph blocks/u ],
      [ 'GRAPH <g> <s> <p> <o> .', /Expected \{ after GRAPH label/u ],
      [ 'GRAPH "g" { }', /Invalid graph term Literal/u ],
      [ 'GRAPH [ <p> <o> ] { }', /Invalid graph term BlankNode/u ],
      [ '<<( <s> <p> <o> )>> { }', /Invalid graph term Quad/u ],
      [ '<< <s> <p> <o> >> { }', /Invalid graph term BlankNode/u ],
      [ '(<a>) { }', /Invalid graph term BlankNode/u ],
      [ '[ <p> <o> ] { }', /Invalid graph term BlankNode/u ],
      [ '<<( <s> <p> <o> ) > <p> <o> .', /Expected >> after triple term/u ],
      [ '<< <s> <p> <o> > <p> <o> .', /Expected >> after reified triple/u ],
      [ '<< "s" <p> <o> >> <p> <o> .', /Invalid reified triple subject term Literal/u ],
      [ '<< <<( <a> <b> <c> )>> <p> <o> >> <q> <r> .', /Invalid reified triple subject term Quad/u ],
      [ '<<[ <q> <r> ] <p> <o> >> <p> <o> .', /Invalid reified triple subject term BlankNode/u ],
      [ '<< <s> <p>(<o>) >> <p> <o> .', /Invalid reified triple object term BlankNode/u ],
      [ '<< <s> <p> <o> ~ "r" >> <p> <o> .', /Invalid reifier term Literal/u ],
      [ '<< <s> <p> <o> ~ [ <q> <r> ] >> <p> <o> .', /Invalid reified triple reifier term BlankNode/u ],
      [ '<s> <p> "a"@en--up .', /Invalid base direction/u ],
      [ String.raw`<http://a/ > <p> <o> .`, /Invalid character in IRI/u ],
      [ 'MESSAGE <s> <p> <o> .', /RDF Messages are not enabled/u ],
    ];
    for (const [ input, error ] of cases) {
      expect(() => ids(input), input).toThrow(error);
    }
  });

  it('strips a leading byte order mark', () => {
    expect(ids('\uFEFF<s> <p> <o> .')).toEqual([ `<${EX}s> <${EX}p> <${EX}o> .` ]);
  });

  it('keeps blank node labels stable within a message', () => {
    const output = <MessageQuad[]> new Parser({ rdfMessages: true }).parse('_:a <http://p> _:a .');
    expect(output[0]!.quad.subject).toBe(output[0]!.quad.object);
  });
});

describe('Parser callbacks', () => {
  it('calls the callback per quad and once at the end', () => {
    const calls: (string | null)[] = [];
    const result = new Parser().parse(`${PREFIX}ex:s ex:p ex:o .`, (error, quad, prefixes) => {
      expect(error).toBeNull();
      expect(Object.keys(prefixes ?? {})).toEqual([ 'ex' ]);
      calls.push(quad ? quadToString(quad) : null);
    });
    expect(result).toBeUndefined();
    expect(calls).toEqual([ `<${EX}s> <${EX}p> <${EX}o> .`, null ]);
  });

  it('passes message counters in RDF Messages mode', () => {
    const calls: [string | null, number | undefined][] = [];
    new Parser().parse('VERSION "1.2-messages"\n<http://s> <http://p> <http://o> .\nMESSAGE\n<http://s> <http://p> <http://o2> .', (error, quad, _prefixes, counter) => {
      expect(error).toBeNull();
      calls.push([ quad ? quadToString(quad) : null, counter ]);
    });
    expect(calls).toEqual([
      [ '<http://s> <http://p> <http://o> .', 0 ],
      [ '<http://s> <http://p> <http://o2> .', 1 ],
      [ null, undefined ],
    ]);
  });

  it('passes parse errors to the callback', () => {
    const errors: Error[] = [];
    expect(new Parser().parse('<s> <p>', error => errors.push(error!))).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/Unexpected end of input on line 1\./u);
  });

  it('wraps non-Error exceptions thrown by the data factory', () => {
    const factory = {
      ...DataFactory,
      namedNode: (): never => throwValue('factory failure'),
    };
    const errors: Error[] = [];
    new Parser({ factory }).parse('<http://s> <http://p> <http://o> .', error => errors.push(error!));
    expect(errors[0]).toBeInstanceOf(Error);
    expect(errors[0]!.message).toBe('factory failure');
    expect(() => new Parser({ factory }).parse('<http://s> <http://p> <http://o> .')).toThrow();
  });
});
