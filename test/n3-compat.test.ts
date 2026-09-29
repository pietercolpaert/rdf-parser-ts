import { readFileSync } from 'node:fs';
import type * as RDF from '@rdfjs/types';
import { DataFactory } from 'rdf-data-factory';
import { isomorphic } from 'rdf-isomorphic';
import { describe, expect, it } from 'vitest';
import { IncrementalParser, Parser, type ParserOptions } from '../src';
import { quadToString } from '../src/serialize';

/**
 * Replays the declarative parser tests of N3.js (extracted by scripts/extract-n3-parser-tests.cjs).
 * Parse results are compared up to blank node renaming; for errors only the fact that parsing fails is checked,
 * since error messages are implementation-specific.
 */

interface JsonTerm {
  termType: string;
  value?: string;
  language?: string;
  direction?: string;
  datatype?: string;
  subject?: JsonTerm;
  predicate?: JsonTerm;
  object?: JsonTerm;
  graph?: JsonTerm;
}

interface N3Case {
  suite: string;
  name: string;
  kind: 'parse' | 'parseWithComments' | 'comments' | 'error' | 'errorWithComments' | 'resolve';
  options: ParserOptions;
  input: string;
  expected?: JsonTerm[][];
  expectedComments?: string[];
  expectedIri?: string;
}

const RDF_REIFIES = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies';

/** Rewrites an N3.js IRI-resolution case with a relative base into one with an absolute base. */
function absoluteBase(baseIRI: string, expectedIri: string): (testCase: N3Case) => void {
  return (testCase) => {
    testCase.name = testCase.name.replace(/against <[^>]*>/u, `against <${baseIRI}>`);
    testCase.options = { baseIRI };
    testCase.expectedIri = expectedIri;
  };
}

/**
 * Corrections to N3.js cases, keyed by `suite › name`.
 * - N3.js resolves against relative base IRIs such as `./`, for which RFC 3986 defines no result; these cases
 *   are rewritten to use an equivalent absolute base.
 * - N3.js puts the `rdf:reifies` quad of an annotation inside a graph into the default graph. RDF 1.2 TriG
 *   (https://www.w3.org/TR/rdf12-trig/#sec-parsing-triples) adds every produced triple to the current graph,
 *   as the W3C eval test trig12-annotation-01 also expects.
 */
const CORRECTIONS: Record<string, (testCase: N3Case) => void> = {
  'IRI resolution › additional cases › resolves <abc> against <./>':
    absoluteBase('http://example.org/./', 'http://example.org/abc'),
  'IRI resolution › additional cases › resolves <abc> against <../>':
    absoluteBase('http://example.org/../', 'http://example.org/abc'),
  'IRI resolution › additional cases › resolves <././abc> against <./././>':
    absoluteBase('http://example.org/./././', 'http://example.org/abc'),
  'IRI resolution › additional cases › resolves <../../abc> against <../../../>':
    absoluteBase('http://example.org/../../../', 'http://example.org/abc'),
  'IRI resolution › additional cases › resolves <././abc> against <.../././>':
    absoluteBase('http://example.org/.../././', 'http://example.org/.../abc'),
  'A Parser instance › should parse a reified triple in a graph using annotation syntax with one predicate-object':
    (testCase) => {
      for (const quad of testCase.expected!) {
        if (quad[1]!.value === RDF_REIFIES) {
          quad[3] = { termType: 'NamedNode', value: 'http://example.org/G' };
        }
      }
    },
};

const DF = new DataFactory<RDF.BaseQuad>();

function toTerm(term: JsonTerm): RDF.Term {
  switch (term.termType) {
    case 'NamedNode':
      return DF.namedNode(term.value!);
    case 'BlankNode':
      return DF.blankNode(term.value);
    case 'Variable':
      return DF.variable(term.value!);
    case 'DefaultGraph':
      return DF.defaultGraph();
    case 'Literal':
      if (term.language) {
        return term.direction ?
          DF.literal(term.value!, { language: term.language, direction: <'ltr' | 'rtl'>term.direction }) :
          DF.literal(term.value!, term.language);
      }
      return DF.literal(term.value!, DF.namedNode(term.datatype!));
    default:
      return DF.quad(
        toTerm(term.subject!),
        toTerm(term.predicate!),
        toTerm(term.object!),
        toTerm(term.graph!),
      );
  }
}

function parse(testCase: N3Case): RDF.BaseQuad[] {
  return <RDF.BaseQuad[]>(new Parser(testCase.options).parse(testCase.input) ?? []);
}

function run(testCase: N3Case): void {
  switch (testCase.kind) {
    case 'parse':
    case 'parseWithComments': {
      const actual = parse(testCase);
      const expected = testCase.expected!.map(([ s, p, o, g ]) =>
        DF.quad(toTerm(s!), toTerm(p!), toTerm(o!), toTerm(g!)));
      if (!isomorphic(<RDF.Quad[]>actual, <RDF.Quad[]>expected)) {
        expect(actual.map(quadToString).sort()).toEqual(expected.map(quadToString).sort());
        throw new Error('Graphs are not isomorphic');
      }
      break;
    }
    case 'comments': {
      const comments: string[] = [];
      new IncrementalParser(testCase.options, { comment: comment => comments.push(comment) }).end(testCase.input);
      expect(comments).toEqual(testCase.expectedComments);
      break;
    }
    case 'error':
    case 'errorWithComments':
      expect(() => parse(testCase)).toThrow(Error);
      break;
    case 'resolve':
      expect(parse(testCase)[0]?.object.value).toBe(testCase.expectedIri);
      break;
  }
}

const fixture = <{ commit: string; cases: N3Case[] }>JSON.parse(
  readFileSync(new URL('fixtures/n3-parser-cases.json', import.meta.url), 'utf8'),
);
const cases = fixture.cases;
const suites = new Map<string, N3Case[]>();
for (const testCase of cases) {
  const suite = testCase.suite || 'A Parser instance';
  suites.set(suite, [ ...suites.get(suite) ?? [], testCase ]);
}

describe(`N3.js parser tests (${fixture.commit.slice(0, 7)})`, () => {
  for (const [ suite, suiteCases ] of suites) {
    describe(suite, () => {
      for (const testCase of suiteCases) {
        const correct = CORRECTIONS[`${suite} › ${testCase.name}`];
        correct?.(testCase);
        it(correct ? `${testCase.name} (corrected)` : testCase.name, () => run(testCase));
      }
    });
  }
});
