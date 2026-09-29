import type * as RDF from '@rdfjs/types';
import { describe, expect, it } from 'vitest';
import { Parser } from '../src';
import { quadToString } from './serialize';

const REIFIES = '<http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies>';

function ids(input: string, baseIRI = 'http://example.org/', format?: string): string[] {
  return (<RDF.BaseQuad[]>(new Parser({ baseIRI, format }).parse(input) ?? [])).map(quadToString);
}

function resolve(iri: string, baseIRI: string): string {
  return (<RDF.BaseQuad[]> new Parser({ baseIRI }).parse(`<urn:s> <urn:p> <${iri}> .`))[0]!.object.value;
}

describe('RDF 1.2 annotations', () => {
  it('reifies an annotated triple with an explicit reifier and an annotation block', () => {
    expect(ids('<s> <p> <o> ~ <r> {| <q> <v> |} .')).toEqual([
      '<http://example.org/s> <http://example.org/p> <http://example.org/o> .',
      `<http://example.org/r> ${REIFIES} <<(<http://example.org/s> <http://example.org/p> <http://example.org/o>)>> .`,
      '<http://example.org/r> <http://example.org/q> <http://example.org/v> .',
    ]);
  });

  it('uses a fresh blank node reifier for annotation blocks without a reifier', () => {
    expect(ids('<s> <p> <o> {| <q> <v> |} .')).toEqual([
      '<http://example.org/s> <http://example.org/p> <http://example.org/o> .',
      `_:b0 ${REIFIES} <<(<http://example.org/s> <http://example.org/p> <http://example.org/o>)>> .`,
      '_:b0 <http://example.org/q> <http://example.org/v> .',
    ]);
  });

  it('accepts repeated semicolons', () => {
    expect(ids('<s> <p> <o> ;; <q> <v> ;;; .')).toHaveLength(2);
  });

  it('parses standalone reified triples', () => {
    expect(ids('<< <s> <p> <o> ~ <r> >> .')).toEqual([
      `<http://example.org/r> ${REIFIES} <<(<http://example.org/s> <http://example.org/p> <http://example.org/o>)>> .`,
    ]);
  });

  it('rejects malformed annotations', () => {
    expect(() => ids('<s> <p> <o> {| <q> <v> | } .')).toThrow(/Expected \|\} after annotation block/u);
    expect(() => ids('<< <s> <p> <o> ~ true >> .')).toThrow(/Invalid reifier term Literal/u);
    expect(() => ids('<urn:s> <urn:p> <urn:o> ~ <urn:r> .', undefined, 'application/n-triples'))
      .toThrow(/Annotations are not allowed in this format/u);
  });

  it('rejects Unicode escapes of surrogates', () => {
    expect(() => ids('<s> <p> "\\uD83D\\uDE00" .')).toThrow(/must not encode surrogates/u);
  });
});

describe('IRI resolution', () => {
  it('keeps absolute IRIs as written', () => {
    expect(resolve('http://ex.org/a/../b', 'http://example.org/')).toBe('http://ex.org/a/../b');
  });

  it('resolves network-path references', () => {
    expect(resolve('//ex.org', 'https://example.org/a')).toBe('https://ex.org');
    expect(resolve('//ex.org/a/./b/../c?q#f', 'https://example.org/a')).toBe('https://ex.org/a/c?q#f');
  });

  it('merges with a base that has an authority but no path', () => {
    expect(resolve('a', 'http://ex.org')).toBe('http://ex.org/a');
  });

  it('removes dot segments from merged paths without a leading slash', () => {
    expect(resolve('../c', 'a:b')).toBe('a:c');
    expect(resolve('.', 'a:b')).toBe('a:');
    expect(resolve('..', 'a:b')).toBe('a:');
  });

  it('rejects relative IRIs with a colon in the first path segment', () => {
    expect(() => resolve('a_b:c', 'http://ex.org/')).toThrow(/colon in first path segment/u);
    expect(() => resolve('a_b:c/d', 'http://ex.org/')).toThrow(/colon in first path segment/u);
    expect(resolve('a/b:c', 'http://ex.org/')).toBe('http://ex.org/a/b:c');
  });
});
