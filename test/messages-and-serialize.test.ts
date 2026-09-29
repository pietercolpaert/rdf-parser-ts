import type * as RDF from '@rdfjs/types';
import { DataFactory } from 'rdf-data-factory';
import { describe, expect, it } from 'vitest';
import { Message, isMessageQuad, toMessages, type MessageQuad, type ParserOutputItem } from '../src';
import { quadToString, termToString } from './serialize';

const DF = new DataFactory();
const namedNode = (value: string): RDF.NamedNode => DF.namedNode(value);
const blankNode = (value: string): RDF.BlankNode => DF.blankNode(value);
const literal = (value: string, language?: string): RDF.Literal => DF.literal(value, language);
function quad(subject: RDF.Term, predicate: RDF.Term, object: RDF.Term): RDF.BaseQuad {
  return DF.quad(<RDF.Quad_Subject>subject, <RDF.Quad_Predicate>predicate, <RDF.Quad_Object>object);
}

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
    expect(termToString(DF.variable('x'))).toBe('?x');
    expect(termToString(DF.defaultGraph())).toBe('');
    expect(termToString(quad(blankNode('s'), namedNode('http://p'), literal('o', 'en'))))
      .toBe('<<(_:s <http://p> "o"@en)>>');
  });
});
