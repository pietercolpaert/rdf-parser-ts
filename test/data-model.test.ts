import type * as RDF from '@rdfjs/types';
import { describe, expect, it } from 'vitest';
import {
  BlankNode,
  DataFactory,
  DefaultGraph,
  Literal,
  Message,
  NamedNode,
  Quad,
  Variable,
  blankNode,
  defaultGraph,
  isMessageQuad,
  literal,
  namedNode,
  quad,
  toMessages,
  variable,
  type MessageQuad,
  type ParserOutputItem,
} from '../src';
import { quadToString, termToString } from '../src/serialize';

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';
const RDF_LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';
const RDF_DIR_LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString';

describe('RDF/JS terms', () => {
  it('compares named nodes, blank nodes, variables and the default graph', () => {
    expect(namedNode('http://a').equals(new NamedNode('http://a'))).toBe(true);
    expect(namedNode('http://a').equals(namedNode('http://b'))).toBe(false);
    expect(namedNode('http://a').equals(blankNode('http://a'))).toBe(false);
    expect(namedNode('http://a').equals(null)).toBe(false);
    expect(namedNode('http://a').equals()).toBe(false);
    expect(new BlankNode('b').equals(blankNode('b'))).toBe(true);
    expect(new Variable('v').equals(variable('v'))).toBe(true);
    expect(variable('v').equals(variable('w'))).toBe(false);
    expect(new DefaultGraph().equals(defaultGraph())).toBe(true);
    expect(defaultGraph().equals(namedNode(''))).toBe(false);
  });

  it('compares literals by value, language, direction and datatype', () => {
    expect(literal('a').equals(new Literal('a'))).toBe(true);
    expect(literal('a', 'en').equals(literal('a', 'EN'))).toBe(true);
    expect(literal('a', 'en').equals(literal('a', 'fr'))).toBe(false);
    const ltr = literal('a', { language: 'en', direction: 'ltr' });
    expect(ltr.equals(literal('a', { language: 'en', direction: 'rtl' }))).toBe(false);
    expect(literal('1', namedNode(XSD_INTEGER)).equals(literal('1'))).toBe(false);
  });

  it('compares quads component-wise', () => {
    const a = quad(namedNode('http://s'), namedNode('http://p'), literal('o'));
    expect(a.equals(new Quad(namedNode('http://s'), namedNode('http://p'), literal('o'), defaultGraph()))).toBe(true);
    expect(a.equals(quad(namedNode('http://s'), namedNode('http://p'), literal('o'), namedNode('http://g')))).toBe(false);
    expect(a.equals(quad(namedNode('http://s'), namedNode('http://p'), literal('x')))).toBe(false);
    expect(a.equals(quad(namedNode('http://s'), namedNode('http://x'), literal('o')))).toBe(false);
    expect(a.equals(quad(namedNode('http://x'), namedNode('http://p'), literal('o')))).toBe(false);
    expect(a.equals(namedNode(''))).toBe(false);
  });

  it('picks the default literal datatype from the language', () => {
    expect(new Literal('a').datatype.value).toBe(XSD_STRING);
    expect(new Literal('a', 'en').datatype.value).toBe(RDF_LANG_STRING);
    expect(new Literal('a', 'en').direction).toBeUndefined();
    expect(new Literal('a', 'en', namedNode(RDF_DIR_LANG_STRING), 'ltr').direction).toBe('ltr');
  });
});

describe('DataFactory', () => {
  it('creates literals from languages, directional languages and datatypes', () => {
    expect(termToString(DataFactory.literal('a', ''))).toBe('"a"');
    expect(termToString(DataFactory.literal('a', 'NL'))).toBe('"a"@nl');
    expect(termToString(DataFactory.literal('a', { language: 'EN' }))).toBe('"a"@en');
    expect(DataFactory.literal('a', { language: 'en' }).datatype.value).toBe(RDF_LANG_STRING);
    expect(DataFactory.literal('a', { language: 'en', direction: 'rtl' }).datatype.value).toBe(RDF_DIR_LANG_STRING);
    expect(termToString(DataFactory.literal('1', namedNode(XSD_INTEGER))))
      .toBe('"1"^^<http://www.w3.org/2001/XMLSchema#integer>');
    expect(termToString(DataFactory.literal('a'))).toBe('"a"');
  });

  it('generates fresh blank node labels', () => {
    const first = DataFactory.blankNode();
    const second = DataFactory.blankNode();
    expect(first.value).toMatch(/^b\d+$/u);
    expect(first.equals(second)).toBe(false);
    expect(DataFactory.blankNode('x').value).toBe('x');
  });

  it('creates variables and quads', () => {
    expect(DataFactory.variable('v')).toBeInstanceOf(Variable);
    expect(DataFactory.defaultGraph()).toBe(defaultGraph());
    expect(quadToString(DataFactory.quad(namedNode('http://s'), namedNode('http://p'), variable('o'), blankNode('g'))))
      .toBe('<http://s> <http://p> ?o _:g .');
  });

  it('copies foreign terms and quads with fromTerm and fromQuad', () => {
    const foreignLiteral = <RDF.Literal>{
      termType: 'Literal',
      value: 'a',
      language: 'en',
      direction: 'ltr',
      datatype: { termType: 'NamedNode', value: RDF_DIR_LANG_STRING, equals: () => false },
      equals: () => false,
    };
    const copiedLiteral = DataFactory.fromTerm(foreignLiteral);
    expect(copiedLiteral).toBeInstanceOf(Literal);
    expect(copiedLiteral.direction).toBe('ltr');
    expect(copiedLiteral.datatype).toBeInstanceOf(NamedNode);

    const withNullDirection = DataFactory.fromTerm(<RDF.Literal>{ ...foreignLiteral, direction: null });
    expect(withNullDirection.direction).toBeUndefined();

    expect(DataFactory.fromTerm(<RDF.NamedNode>{ termType: 'NamedNode', value: 'http://a' })).toBeInstanceOf(NamedNode);
    expect(DataFactory.fromTerm(<RDF.BlankNode>{ termType: 'BlankNode', value: 'b' })).toBeInstanceOf(BlankNode);
    expect(DataFactory.fromTerm(<RDF.Variable>{ termType: 'Variable', value: 'v' })).toBeInstanceOf(Variable);
    expect(DataFactory.fromTerm(<RDF.DefaultGraph>{ termType: 'DefaultGraph', value: '' })).toBe(defaultGraph());

    const original = quad(
      namedNode('http://s'),
      namedNode('http://p'),
      quad(blankNode('a'), namedNode('http://q'), literal('x', 'en')),
      namedNode('http://g'),
    );
    const copied = DataFactory.fromQuad(original);
    expect(copied).not.toBe(original);
    expect(copied).toBeInstanceOf(Quad);
    expect(copied.equals(original)).toBe(true);
    expect(DataFactory.fromTerm(<RDF.BaseQuad>original).equals(original)).toBe(true);
  });
});

describe('Message', () => {
  const quads = [
    quad(namedNode('http://s1'), namedNode('http://p'), namedNode('http://o1')),
    quad(namedNode('http://s2'), namedNode('http://p'), namedNode('http://o2')),
  ];

  it('is an array of quads with a message counter', () => {
    const message = new Message(3, quads);
    expect(message).toBeInstanceOf(Message);
    expect(message).toBeInstanceOf(Array);
    expect(message.messageCounter).toBe(3);
    expect(Array.from(message, quadToString)).toEqual([
      '<http://s1> <http://p> <http://o1> .',
      '<http://s2> <http://p> <http://o2> .',
    ]);
    expect(new Message(0)).toHaveLength(0);
  });

  it('derives plain arrays from array methods', () => {
    const mapped = new Message(0, quads).map(quadToString);
    expect(mapped).not.toBeInstanceOf(Message);
    expect(mapped).toHaveLength(2);
  });
});

describe('toMessages', () => {
  const q1 = quad(namedNode('http://s1'), namedNode('http://p'), namedNode('http://o1'));
  const q2 = quad(namedNode('http://s2'), namedNode('http://p'), namedNode('http://o2'));

  it('assigns plain quads to the first message', () => {
    const messages = toMessages([ q1, q2 ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.messageCounter).toBe(0);
    expect(Array.from(messages[0]!, quadToString)).toEqual([
      '<http://s1> <http://p> <http://o1> .',
      '<http://s2> <http://p> <http://o2> .',
    ]);
  });

  it('returns no messages for empty output without a message count', () => {
    expect(toMessages([])).toEqual([]);
    expect(toMessages(new Set<ParserOutputItem>())).toEqual([]);
  });

  it('groups message quads from any iterable and fills gaps with empty messages', () => {
    const entries: MessageQuad[] = [{ quad: q1, messageCounter: 0 }, { quad: q2, messageCounter: 2 }];
    const messages = toMessages(new Set(entries));
    expect(messages.map(message => message.length)).toEqual([ 1, 0, 1 ]);
    expect(messages.map(message => message.messageCounter)).toEqual([ 0, 1, 2 ]);
  });

  it('uses an explicit or recorded message count to add trailing empty messages', () => {
    const entries: MessageQuad[] = [{ quad: q1, messageCounter: 0 }];
    expect(toMessages(entries, 3)).toHaveLength(3);
    expect(toMessages(Object.assign([ ...entries ], { messageCount: 2 }))).toHaveLength(2);
    expect(toMessages(Object.assign([ ...entries ], { messageCount: 'two' }))).toHaveLength(1);
  });

  it('recognizes message quads', () => {
    expect(isMessageQuad({ quad: q1, messageCounter: 0 })).toBe(true);
    expect(isMessageQuad(q1)).toBe(false);
    expect(isMessageQuad(null)).toBe(false);
    expect(isMessageQuad('quad')).toBe(false);
  });
});

describe('serialize', () => {
  it('escapes IRIs and literals', () => {
    expect(termToString(namedNode('http://a/>\\'))).toBe(String.raw`<http://a/\>\\>`);
    expect(termToString(literal('"\\\n\r\t\b\f'))).toBe(String.raw`"\"\\\n\r\t\b\f"`);
  });

  it('serializes variables, the default graph and quads in the graph position', () => {
    expect(termToString(variable('x'))).toBe('?x');
    expect(termToString(defaultGraph())).toBe('');
    expect(termToString(quad(blankNode('s'), namedNode('http://p'), literal('o', 'en'))))
      .toBe('<<(_:s <http://p> "o"@en)>>');
  });
});
