import type * as RDF from '@rdfjs/types';
import { describe, expect, it } from 'vitest';
import { Parser } from '../src';

const EX = 'http://example.org/';

function object(input: string): RDF.Term {
  return (<RDF.BaseQuad[]> new Parser({ format: 'text/turtle' }).parse(`@prefix ex: <${EX}> .\n<${EX}s> <${EX}p> ${input} .`))[0]!.object;
}

/** PN_CHARS_BASE ranges from the Turtle grammar, beyond ASCII letters */
const PN_CHARS_BASE_RANGES: [number, number][] = [
  [ 0xC0, 0xD6 ],
  [ 0xD8, 0xF6 ],
  [ 0xF8, 0x2FF ],
  [ 0x370, 0x37D ],
  [ 0x37F, 0x1FFF ],
  [ 0x200C, 0x200D ],
  [ 0x2070, 0x218F ],
  [ 0x2C00, 0x2FEF ],
  [ 0x3001, 0xD7FF ],
  [ 0xF900, 0xFDCF ],
  [ 0xFDF0, 0xFFFD ],
  [ 0x10000, 0xEFFFF ],
];
/** Characters just outside those ranges that are not name characters at all */
const NOT_NAME_CHARS = [ 0xD7, 0xF7, 0x37E, 0x2000, 0x2190, 0x2FF0, 0x3000, 0xFDD0, 0xFFFE, 0xF0000 ];
/** PN_CHARS that may not start a name */
const NON_LEADING = [ 0xB7, 0x300, 0x36F, 0x203F, 0x2040 ];

const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase()}`;

describe('Turtle names', () => {
  it('accepts every PN_CHARS_BASE range at the start of a local name and a blank node label', () => {
    for (const [ low, high ] of PN_CHARS_BASE_RANGES) {
      for (const cp of [ low, high ]) {
        const character = String.fromCodePoint(cp);
        expect(object(`ex:${character}`).value, hex(cp)).toBe(EX + character);
        expect(object(`_:${character}`).termType, hex(cp)).toBe('BlankNode');
      }
    }
  });

  it('accepts non-leading PN_CHARS only after the first character', () => {
    for (const cp of NON_LEADING) {
      const character = String.fromCodePoint(cp);
      expect(object(`ex:a${character}`).value, hex(cp)).toBe(`${EX}a${character}`);
      expect(() => object(`ex:${character}`), hex(cp)).toThrow(Error);
    }
  });

  it('rejects characters outside PN_CHARS', () => {
    for (const cp of NOT_NAME_CHARS) {
      expect(() => object(`ex:a${String.fromCodePoint(cp)}`), hex(cp)).toThrow(Error);
    }
  });

  it('accepts non-ASCII prefixes', () => {
    expect((<RDF.BaseQuad[]> new Parser().parse(`@prefix é.x: <${EX}> . é.x:s é.x:p é.x:o .`))[0]!.subject.value)
      .toBe(`${EX}s`);
  });

  it('resolves local name escapes and keeps percent-encodings', () => {
    expect(object('ex:a\\~b\\.').value).toBe(`${EX}a~b.`);
    expect(object('ex:a%41').value).toBe(`${EX}a%41`);
    expect(() => object('ex:a\\q')).toThrow(/Invalid escape in local name/u);
    expect(() => object('ex:a%4')).toThrow(/Invalid percent-encoding in local name/u);
  });

  it('rejects directives inside graph blocks', () => {
    expect(() => new Parser().parse(`{ @prefix ex: <${EX}> . }`)).toThrow(/Directives are not allowed inside graph blocks/u);
  });
});
