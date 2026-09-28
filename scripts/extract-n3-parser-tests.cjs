#!/usr/bin/env node
'use strict';

/**
 * Extracts the declarative parser test cases (shouldParse, shouldNotParse, shouldCallbackComments and
 * itShouldResolve) from N3.js's test/N3Parser-test.js into test/fixtures/n3-parser-cases.json, so they can
 * be replayed against this parser by test/n3-compat.test.ts.
 *
 * Usage: node scripts/extract-n3-parser-tests.cjs [path/to/N3.js]
 *
 * The N3.js repository must have been built (its lib/ folder is used to turn expected term ids into terms).
 * N3.js is © Ruben Verborgh and contributors, MIT licensed.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const n3Root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'N3.js'));
const n3 = require(path.join(n3Root, 'lib'));
const testFile = path.join(n3Root, 'test', 'N3Parser-test.js');
const outFile = path.join(__dirname, '..', 'test', 'fixtures', 'n3-parser-cases.json');
const BASE_IRI = 'http://example.org/';

// Only the part before the helper function definitions contains test declarations.
let source = fs.readFileSync(testFile, 'utf8');
source = source.slice(0, source.indexOf('\nfunction shouldParse('));
source = source.replaceAll(/^import .*$/gmu, '');

const cases = [];
const describePath = [];

class RecordingParser {
  constructor(options = {}) {
    this.options = options;
  }
}
RecordingParser.prototype._factory = {};
RecordingParser._resetBlankNodePrefix = () => {};

function termToJson(term) {
  switch (term.termType) {
    case 'Literal':
      return {
        termType: 'Literal',
        value: term.value,
        language: term.language,
        direction: term.direction || '',
        datatype: term.datatype.value,
      };
    case 'Quad':
      return {
        termType: 'Quad',
        subject: termToJson(term.subject),
        predicate: termToJson(term.predicate),
        object: termToJson(term.object),
        graph: termToJson(term.graph),
      };
    default:
      return { termType: term.termType, value: term.value };
  }
}

// Mirrors mapToQuad in N3Parser-test.js
function mapToQuad(item) {
  const terms = item.map(t => {
    if (typeof t === 'object') {
      return Array.isArray(t) ? mapToQuad(t) : t;
    }
    if (!/^$|^["?]|:/u.test(t)) {
      t = BASE_IRI + t;
    }
    return n3.termFromId(t);
  });
  return new n3.Quad(terms[0], terms[1], terms[2], terms[3]);
}

function optionsOf(parser) {
  const options = parser === RecordingParser ? { baseIRI: BASE_IRI } : parser().options;
  return JSON.parse(JSON.stringify(options, (key, value) => (key === 'factory' ? undefined : value)));
}

const marker = Symbol('case');
function helper(kind) {
  return (...args) => {
    let parser = RecordingParser;
    if (typeof args[0] === 'function') {
      parser = args.shift();
    }
    const [input, ...rest] = args;
    const testCase = { kind, options: optionsOf(parser), input };
    // N3-only syntax (formulas, quantifiers, rules) is out of scope for this parser.
    if (/n3/iu.test(String(testCase.options.format ?? ''))) {
      return () => {};
    }
    if (kind === 'parse' || kind === 'parseWithComments') {
      testCase.expected = rest.map(item => {
        const quad = mapToQuad(item);
        return [ quad.subject, quad.predicate, quad.object, quad.graph ].map(termToJson);
      });
    } else if (kind === 'comments') {
      testCase.expectedComments = rest;
    } else {
      testCase.expectedError = rest[0];
    }
    // Callable, so that bodies such as `(tag, done) => shouldParse(...)(done)` in it.each still yield the case
    const recorded = () => recorded;
    recorded[marker] = testCase;
    return recorded;
  };
}

const globals = {
  Parser: RecordingParser,
  NamedNode: n3.NamedNode,
  BlankNode: n3.BlankNode,
  Quad: n3.Quad,
  termFromId: n3.termFromId,
  DF: n3.DataFactory,
  rdfDataModel: n3.DataFactory,
  isomorphic: () => true,
  expect: () => new Proxy(() => {}, { get: () => () => {} }),
  beforeEach: () => {},
  beforeAll: () => {},
  describe(name, body) {
    describePath.push(name);
    body();
    describePath.pop();
  },
  it: Object.assign((name, body) => {
    if (body && body[marker]) {
      cases.push({ suite: describePath.slice(1).join(' › '), name, ...body[marker] });
    }
  }, {
    each: rows => (name, body) => {
      for (const row of rows) {
        const recorded = body(row, () => {});
        globals.it(name.replace('%s', row), recorded);
      }
    },
  }),
  shouldParse: helper('parse'),
  shouldParseWithCommentsEnabled: helper('parseWithComments'),
  shouldNotParse: helper('error'),
  shouldNotParseWithComments: helper('errorWithComments'),
  shouldCallbackComments: helper('comments'),
  itShouldResolve(baseIRI, relativeIri, expected) {
    cases.push({
      suite: describePath.slice(1).join(' › '),
      name: `resolves <${relativeIri}> against <${baseIRI}>`,
      kind: 'resolve',
      options: { baseIRI },
      input: `<urn:ex:s> <urn:ex:p> <${relativeIri}>.`,
      expectedIri: expected,
    });
  },
};

// eslint-disable-next-line no-new-func
new Function(...Object.keys(globals), source)(...Object.values(globals));

let commit = 'unknown';
try {
  commit = execSync('git rev-parse HEAD', { cwd: n3Root }).toString().trim();
} catch {
  // Not a git checkout
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify({
  source: 'https://github.com/rdfjs/N3.js/blob/main/test/N3Parser-test.js',
  license: 'MIT, © Ruben Verborgh and N3.js contributors',
  commit,
  cases,
}, null, 1)}\n`);
console.log(`Extracted ${cases.length} cases to ${path.relative(process.cwd(), outFile)}`);
