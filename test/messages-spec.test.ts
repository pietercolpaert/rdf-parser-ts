import { describe, expect, it } from 'vitest';
import { Parser, isMessageQuad, toMessages, type Message } from '../src';
import { quadToString } from '../src/serialize';

const SPEC_URL = 'https://w3c-cg.github.io/rsp/spec/messages-tests';
const url = (fragment: string): string => `${SPEC_URL}#${fragment}`;

function messageIds(messages: Message[]): string[][] {
  return messages.map(message => Array.from(message, quadToString));
}

function parseMessages(input: string, format?: string): Message[] {
  return new Parser({ format }).parseMessages(input);
}

describe('RDF Messages spec parsing tests', () => {
  const parsingCases = [
    {
      name: '1.1.1 Single Message Without Delimiter',
      url: url('single-message-without-delimiter'),
      input: `VERSION "1.2-messages"
<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .`,
      expected: [
        [ '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .' ],
      ],
    },
    {
      name: '1.1.2 Two Messages With MESSAGE',
      url: url('two-messages-with-message'),
      input: `VERSION "1.2-messages"
<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .
MESSAGE
<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .`,
      expected: [
        [ '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .' ],
        [ '<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .' ],
      ],
    },
    {
      name: '1.1.3 Two Messages With @message .',
      url: url('two-messages-with-at-message'),
      input: `@version "1.2-messages" .
@prefix ex: <http://example.org/> .

ex:s1 ex:p ex:o1 .
@message .
ex:s2 ex:p ex:o2 .`,
      expected: [
        [ '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .' ],
        [ '<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .' ],
      ],
    },
    {
      name: '1.1.4 Empty First Message',
      url: url('empty-first-message'),
      input: `VERSION "1.2-messages"
MESSAGE
<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .`,
      expected: [
        [],
        [ '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .' ],
      ],
    },
    {
      name: '1.1.5 Empty Message Between Non-Empty Messages',
      url: url('empty-message-between-non-empty-messages'),
      input: `VERSION "1.2-messages"
<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .
MESSAGE
MESSAGE
<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .`,
      expected: [
        [ '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .' ],
        [],
        [ '<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .' ],
      ],
    },
    {
      name: '1.1.6 Final Delimiter Does Not Create Extra Empty Message',
      url: url('final-delimiter-does-not-create-extra-empty-message'),
      input: `VERSION "1.2-messages"
<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .
MESSAGE`,
      expected: [
        [ '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .' ],
      ],
    },
    {
      name: '1.1.7 N-Quads Messages Preserve Graph Names',
      url: url('n-quads-messages-preserve-graph-names'),
      format: 'n-quads',
      input: `VERSION "1.2-messages"
<http://example.org/s1> <http://example.org/p> <http://example.org/o1> <http://example.org/g1> .
MESSAGE
<http://example.org/s2> <http://example.org/p> <http://example.org/o2> <http://example.org/g2> .`,
      expected: [
        [ '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> <http://example.org/g1> .' ],
        [ '<http://example.org/s2> <http://example.org/p> <http://example.org/o2> <http://example.org/g2> .' ],
      ],
    },
    {
      name: '1.1.8 Message With Default Graph And Named Graph Quads',
      url: url('message-with-default-graph-and-named-graph-quads'),
      input: `VERSION "1.2-messages"
PREFIX ex: <http://example.org/>

ex:s1 ex:p ex:o1 .
ex:g {
  ex:s2 ex:p ex:o2 .
  ex:s3 ex:p ex:o3 .
}
MESSAGE
ex:s4 ex:p ex:o4 .`,
      expected: [
        [
          '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .',
          '<http://example.org/s2> <http://example.org/p> <http://example.org/o2> <http://example.org/g> .',
          '<http://example.org/s3> <http://example.org/p> <http://example.org/o3> <http://example.org/g> .',
        ],
        [ '<http://example.org/s4> <http://example.org/p> <http://example.org/o4> .' ],
      ],
    },
    {
      name: '1.1.10 Repeated Prefixes Across Messages',
      url: url('repeated-prefixes-across-messages'),
      input: `VERSION "1.2-messages"
PREFIX ex: <http://example.org/one/>
ex:s ex:p ex:o .
MESSAGE
PREFIX ex: <http://example.org/two/>
ex:s ex:p ex:o .`,
      expected: [
        [ '<http://example.org/one/s> <http://example.org/one/p> <http://example.org/one/o> .' ],
        [ '<http://example.org/two/s> <http://example.org/two/p> <http://example.org/two/o> .' ],
      ],
    },
    {
      name: '1.1.11 Message Boundary After A Graph Block',
      url: url('message-boundary-after-a-graph-block'),
      input: `VERSION "1.2-messages"
<http://example.org/g> {
  <http://example.org/a> <http://example.org/b> <http://example.org/c> .
}
MESSAGE
<http://example.org/d> <http://example.org/e> <http://example.org/f> .`,
      expected: [
        [ '<http://example.org/a> <http://example.org/b> <http://example.org/c> <http://example.org/g> .' ],
        [ '<http://example.org/d> <http://example.org/e> <http://example.org/f> .' ],
      ],
    },
  ];

  for (const testCase of parsingCases) {
    it(`${testCase.name} — ${testCase.url}`, () => {
      expect(messageIds(parseMessages(testCase.input, testCase.format))).toEqual(testCase.expected);
    });
  }

  it(`1.1.9 Blank Node Labels Are Scoped Per Message — ${url('blank-node-labels-are-scoped-per-message')}`, () => {
    const messages = parseMessages(`VERSION "1.2-messages"
_:b0 <http://example.org/p> <http://example.org/o1> .
MESSAGE
_:b0 <http://example.org/p> <http://example.org/o2> .`);

    const first = messages[0]?.[0]?.subject;
    const second = messages[1]?.[0]?.subject;
    expect(first?.termType).toBe('BlankNode');
    expect(second?.termType).toBe('BlankNode');
    expect(first?.equals(second)).toBe(false);
  });

  it(`mixes @message/@prefix and MESSAGE/PREFIX directives — ${url('two-messages-with-at-message')} ${url('repeated-prefixes-across-messages')}`, () => {
    const messages = parseMessages(`@version "1.2-messages" .
PREFIX ex: <http://example.org/one/>
ex:s ex:p ex:o .
@message .
@prefix ex: <http://example.org/two/> .
ex:s ex:p ex:o .
MESSAGE
PREFIX ex: <http://example.org/three/>
ex:s ex:p ex:o .`);

    expect(messageIds(messages)).toEqual([
      [ '<http://example.org/one/s> <http://example.org/one/p> <http://example.org/one/o> .' ],
      [ '<http://example.org/two/s> <http://example.org/two/p> <http://example.org/two/o> .' ],
      [ '<http://example.org/three/s> <http://example.org/three/p> <http://example.org/three/o> .' ],
    ]);
  });

  it(`accepts compact @message. delimiters — ${url('two-messages-with-at-message')}`, () => {
    const messages = parseMessages(`@version "1.1-messages".
<http://example.org/s1> <http://example.org/p> <http://example.org/o1>.
@message.
<http://example.org/s2> <http://example.org/p> <http://example.org/o2>.`);

    expect(messageIds(messages)).toEqual([
      [ '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .' ],
      [ '<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .' ],
    ]);
  });

  it(`parses mixed legacy and uppercase message delimiters with a trailing empty message — ${url('two-messages-with-at-message')} ${url('empty-message-between-non-empty-messages')}`, () => {
    const messages = parseMessages(`@version "1.2-messages" .
@prefix ex: <http://example.org/>.
ex:m1 ex:p ex:o1 .
@message .
ex:m2 ex:p ex:o2 .
MESSAGE
MESSAGE`);

    expect(messageIds(messages)).toEqual([
      [ '<http://example.org/m1> <http://example.org/p> <http://example.org/o1> .' ],
      [ '<http://example.org/m2> <http://example.org/p> <http://example.org/o2> .' ],
      [],
    ]);
  });

  it(`preserves trailing empty messages after a reified triple — ${url('empty-message-between-non-empty-messages')}`, () => {
    const messages = parseMessages(`@version "1.2-messages" .
@prefix ex: <http://example.org/>.
ex:m1 ex:p ex:o1 .
@message .
ex:m2 ex:p ex:o2 .
MESSAGE
MESSAGE
ex:m3 ex:p << ex:s1 ex:p ex:o3 >> .
MESSAGE
MESSAGE`);

    expect(messageIds(messages)).toEqual([
      [ '<http://example.org/m1> <http://example.org/p> <http://example.org/o1> .' ],
      [ '<http://example.org/m2> <http://example.org/p> <http://example.org/o2> .' ],
      [],
      [
        '_:m3_b0 <http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies> <<(<http://example.org/s1> <http://example.org/p> <http://example.org/o3>)>> .',
        '<http://example.org/m3> <http://example.org/p> _:m3_b0 .',
      ],
      [],
    ]);
  });
});

describe('RDF Messages spec error tests', () => {
  it(`1.3.1 Message Delimiter Without Message Support — ${url('message-delimiter-without-message-support')}`, () => {
    expect(() => new Parser().parse(`<http://example.org/s> <http://example.org/p> <http://example.org/o> .
MESSAGE`)).toThrow(/RDF Messages are not enabled/u);
  });

  it(`1.3.2 @message Without Trailing Dot — ${url('at-message-without-trailing-dot')}`, () => {
    expect(() => new Parser().parse(`VERSION "1.2-messages"
<http://example.org/s> <http://example.org/p> <http://example.org/o> .
@message <http://example.org/invalid>`)).toThrow(/Expected \./u);
  });

  it(`1.3.3 Message Delimiter Inside An Open Graph Block — ${url('message-delimiter-inside-an-open-graph-block')}`, () => {
    expect(() => new Parser().parse(`VERSION "1.2-messages"
<http://example.org/g> {
  <http://example.org/a> <http://example.org/b> <http://example.org/c> .
MESSAGE
  <http://example.org/d> <http://example.org/e> <http://example.org/f> .
}`)).toThrow(/inside graph blocks/u);
  });
});

describe('RDF Messages parser output', () => {
  it(`emits MessageQuad entries when a version label enables RDF Messages — ${url('single-message-without-delimiter')}`, () => {
    const output = new Parser().parse(`VERSION "1.2-messages"
<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .`) ?? [];

    expect(output.every(isMessageQuad)).toBe(true);
    expect(toMessages(output).map(message => message.messageCounter)).toEqual([ 0 ]);
  });
});
