import type * as RDF from '@rdfjs/types';
import { describe, expect, it } from 'vitest';
import { Parser, type ParserOptions } from '../src';
import { quadToString } from './serialize';

const EX = 'http://example.org/';
const RDF_LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';

function parse(input: string, options: ParserOptions): string[] {
  return (<RDF.BaseQuad[]> new Parser(options).parse(input)).map(quadToString);
}

function nt(input: string, options: ParserOptions = {}): string[] {
  return parse(input, { format: 'application/n-triples', ...options });
}
function nq(input: string, options: ParserOptions = {}): string[] {
  return parse(input, { format: 'application/n-quads', ...options });
}

describe('N-Triples and N-Quads', () => {
  it('parses IRIs, blank nodes and literals', () => {
    expect(nt(`<${EX}s> <${EX}p> <${EX}o> .
_:a <${EX}p> _:b.c .
_:a.b <${EX}p> "plain" .
<${EX}s> <${EX}p> "tagged"@EN-us1 .
<${EX}s> <${EX}p> "dir"@en--rtl .
<${EX}s>\t<${EX}p>\t"1"^^<http://www.w3.org/2001/XMLSchema#integer>\t.
`)).toEqual([
      `<${EX}s> <${EX}p> <${EX}o> .`,
      `_:a <${EX}p> _:b.c .`,
      `_:a.b <${EX}p> "plain" .`,
      `<${EX}s> <${EX}p> "tagged"@en-us1 .`,
      `<${EX}s> <${EX}p> "dir"@en--rtl .`,
      `<${EX}s> <${EX}p> "1"^^<http://www.w3.org/2001/XMLSchema#integer> .`,
    ]);
  });

  it('parses blank nodes directly followed by the statement dot', () => {
    expect(nt(`<${EX}s> <${EX}p> _:o.`)).toEqual([ `<${EX}s> <${EX}p> _:o .` ]);
  });

  it('parses N-Quads graph labels', () => {
    expect(nq(`<${EX}s> <${EX}p> <${EX}o> <${EX}g> .
<${EX}s> <${EX}p> "o" _:g .
<${EX}s> <${EX}p> <${EX}o> .`)).toEqual([
      `<${EX}s> <${EX}p> <${EX}o> <${EX}g> .`,
      `<${EX}s> <${EX}p> "o" _:g .`,
      `<${EX}s> <${EX}p> <${EX}o> .`,
    ]);
  });

  it('falls back to the full grammar for statements the fast path does not handle', () => {
    expect(nt(String.raw`<http://example.org/s> <${EX}p> "a\tb" .`)).toEqual([
      String.raw`<${EX}s> <${EX}p> "a\tb" .`,
    ]);
    expect(nt(`<${EX}s> <${EX}p> <${EX}o>\n.`)).toEqual([ `<${EX}s> <${EX}p> <${EX}o> .` ]);
    expect(nt(`<${EX}s> <${EX}p> "a"^^<http://example.org/\\u0074> .`)).toEqual([
      `<${EX}s> <${EX}p> "a"^^<${EX}t> .`,
    ]);
  });

  it('reuses named nodes for predicates beyond the cache size', () => {
    const lines = Array.from({ length: 4100 }, (_, i) => `<${EX}s> <${EX}p${i}> <${EX}o> .`);
    const output = nt(`${lines.join('\n')}\n<${EX}s> <${EX}p4099> <${EX}o> .`);
    expect(output).toHaveLength(4101);
    expect(output.at(-1)).toBe(`<${EX}s> <${EX}p4099> <${EX}o> .`);
  });

  it('rejects invalid statements', () => {
    const cases: [string, RegExp][] = [
      [ '<s> <http://example.org/p> <http://example.org/o> .', /Relative IRIs are not allowed/u ],
      [ `<${EX}s> <${EX}p> <o> .`, /Relative IRIs are not allowed/u ],
      [ `<:s> <${EX}p> <${EX}o> .`, /Relative IRIs are not allowed/u ],
      [ `<${EX}s> <${EX}p> <${EX}o> <${EX}g> .`, /Graph terms are not allowed in N-Triples/u ],
      [ `<${EX}s> <${EX}p> _:o <${EX}g> .`, /Graph terms are not allowed in N-Triples/u ],
      [ `<${EX}s> <${EX}p> "a\\n" <${EX}g> .`, /Graph terms are not allowed in N-Triples/u ],
      [ `<${EX}s> <${EX}p> "a\\n", "b" .`, /Object lists are not allowed/u ],
      [ `<${EX}s> <${EX}p> "a\\n"; <${EX}q> "b" .`, /Predicate lists are not allowed/u ],
      [ `@prefix ex: <${EX}> .`, /Directives are not allowed/u ],
      [ `PREFIX ex: <${EX}>`, /Directives are not allowed/u ],
      [ `BASE <${EX}>`, /Directives are not allowed/u ],
      [ `<${EX}s> <${EX}p> true .`, /Boolean literals are not allowed/u ],
      [ `<${EX}s> <${EX}p> false .`, /Boolean literals are not allowed/u ],
      [ `<${EX}s> <${EX}p> 1 .`, /Numeric literals are not allowed/u ],
      [ `<${EX}s> <${EX}p> 'a' .`, /Only double-quoted literals/u ],
      [ `<${EX}s> <${EX}p> """a""" .`, /Long literals are not allowed/u ],
      [ `<${EX}s> <${EX}p> "a" .x`, /Expected prefixed name/u ],
      [ `<${EX}s> <${EX}p> "a"@ .`, /Expected language tag/u ],
      [ `<${EX}s> <${EX}p> "a"@1a .`, /Expected language tag/u ],
      [ `<${EX}s> <${EX}p> "a"@--ltr .`, /Expected language tag/u ],
      [ `<${EX}s> <${EX}p> "a"@en- .`, /Invalid language tag/u ],
      [ `<${EX}s> <${EX}p> "a"@abcdefghi .`, /Invalid language tag/u ],
      [ `<${EX}s> <${EX}p> "a"@en--up .`, /Invalid base direction/u ],
      [ `<${EX}s> <${EX}p> "a"^^<${RDF_LANG_STRING}> .`, /require an explicit language tag/u ],
      [ `<${EX}s> <${EX}p> "a"^^<${EX}d .`, /Invalid character in IRI/u ],
      [ `<${EX}s> <${EX}p> "a" # comment\n`, /Expected \. after triple/u ],
      [ `<${EX}s> <${EX}p> "a"^^<http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString> .`, /require an explicit language tag/u ],
      [ `<${EX}s> <${EX}p> "a\\n"^^<${RDF_LANG_STRING}> .`, /require an explicit language tag/u ],
      [ `<${EX}s> <${EX}p> "a`, /Unterminated literal/u ],
      [ `<${EX}s> <${EX}p> _: .`, /Expected blank node label/u ],
      [ `_x <${EX}p> <${EX}o> .`, /Expected prefixed name/u ],
      [ `<${EX}s> _:p <${EX}o> .`, /Invalid predicate term BlankNode/u ],
      [ `<${EX}s> <${EX}p> <${EX}o`, /Unterminated IRI/u ],
      [ `<${EX}s> <${EX}p> <${EX}o> ;`, /Predicate lists are not allowed/u ],
      [ `<${EX}s> <${EX}p> <http://example.org/a b> .`, /Invalid character in IRI/u ],
      [ String.raw`<${EX}s> <${EX}p> <http://example.org/\t> .`, /Only Unicode escapes are allowed in IRIs/u ],
      [ `<<( <${EX}s> <${EX}p> <${EX}o> )>> <${EX}p> <${EX}o> .`, /Invalid subject term Quad/u ],
      [ `<< <${EX}s> <${EX}p> <${EX}o> >> <${EX}p> <${EX}o> .`, /Reified triples are not allowed/u ],
    ];
    for (const [ input, error ] of cases) {
      expect(() => nt(input), input).toThrow(error);
    }
    expect(() => nq(`<${EX}s> <${EX}p> <${EX}o> <g> .`)).toThrow(/Relative IRIs are not allowed/u);
    expect(() => nq(`<${EX}s> <${EX}p> <${EX}o> <${EX}g> <${EX}h> .`)).toThrow(/Expected \. after quad/u);
    expect(() => nq(String.raw`<${EX}s> <${EX}p> <http://example.org/\U00000041\n> .`))
      .toThrow(/Only Unicode escapes are allowed in IRIs/u);
  });

  it('parses RDF 1.2 triple terms', () => {
    const expected = `<${EX}s> <${EX}p> <<(<${EX}a> <${EX}b> "c")>> .`;
    expect(nt(`<${EX}s> <${EX}p> <<( <${EX}a> <${EX}b> "c" )>> .`)).toEqual([ expected ]);
    expect(nt(`<${EX}s> <${EX}p> <<( <${EX}a> <${EX}b> "c" )>> .`, { relax: true })).toEqual([ expected ]);
    expect(nt(`<${EX}s> <${EX}p> <<(_:a <${EX}b> <<( _:x <${EX}y> _:z )>>)>> .`, { relax: true })).toEqual([
      `<${EX}s> <${EX}p> <<(_:a <${EX}b> <<(_:x <${EX}y> _:z)>>)>> .`,
    ]);
  });

  it('falls back from the relaxed triple term fast path to the full grammar', () => {
    const relaxed = { relax: true };
    expect(nt(`<${EX}s> <${EX}p> <<( <${EX}a> <${EX}b> "c" ) >> .`, relaxed)).toEqual([
      `<${EX}s> <${EX}p> <<(<${EX}a> <${EX}b> "c")>> .`,
    ]);
    expect(nt(String.raw`<${EX}s> <${EX}p> <<( <${EX}a> <${EX}b> "c\t" )>> .`, relaxed)).toEqual([
      String.raw`<${EX}s> <${EX}p> <<(<${EX}a> <${EX}b> "c\t")>> .`,
    ]);
    expect(() => nt(`<${EX}s> <${EX}p> << <${EX}a> <${EX}b> <${EX}c> >> .`, relaxed))
      .toThrow(/Reified triples are not allowed/u);
    expect(() => nt(`<${EX}s> <${EX}p> <<( "a" <${EX}b> <${EX}c> )>> .`, relaxed))
      .toThrow(/Invalid subject term Literal/u);
    expect(() => nt(`<${EX}s> <${EX}p> <<( <${EX}a> _:b <${EX}c> )>> .`, relaxed))
      .toThrow(/Invalid predicate term BlankNode/u);
  });

  it('skips validation in relax mode', () => {
    const relaxed = { relax: true };
    expect(nt(`<s> <p> <o> .`, relaxed)).toEqual([ '<s> <p> <o> .' ]);
    expect(nt(`<${EX}s> <${EX}p> "a"@1-x .`, relaxed)).toEqual([ `<${EX}s> <${EX}p> "a"@1-x .` ]);
    expect(nt(`<${EX}s> <${EX}p> "a"^^<${RDF_LANG_STRING}> .`, relaxed)).toEqual([
      `<${EX}s> <${EX}p> "a"^^<${RDF_LANG_STRING}> .`,
    ]);
  });
});
