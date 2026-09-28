import type * as RDF from '@rdfjs/types';

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

/**
 * Minimal N-Quads serialization used by the CLI and the tests. It is deliberately not part of the
 * public API: use a dedicated writer such as rdf-writer-ts for serializing RDF.
 */
export function quadToString(quad: RDF.BaseQuad): string {
  const graph = quad.graph.termType === 'DefaultGraph' ? '' : ` ${termToString(quad.graph)}`;
  return `${termToString(quad.subject)} ${termToString(quad.predicate)} ${termToString(quad.object)}${graph} .`;
}

export function termToString(term: RDF.Term): string {
  switch (term.termType) {
    case 'NamedNode':
      return `<${term.value.replaceAll(/[>\\]/gu, character => `\\${character}`)}>`;
    case 'BlankNode':
      return `_:${term.value}`;
    case 'Variable':
      return `?${term.value}`;
    case 'DefaultGraph':
      return '';
    case 'Literal': {
      const quoted = `"${escapeString(term.value)}"`;
      if (term.language) {
        return `${quoted}@${term.direction ? `${term.language}--${term.direction}` : term.language}`;
      }
      if (term.datatype.value === XSD_STRING) {
        return quoted;
      }
      return `${quoted}^^<${term.datatype.value}>`;
    }
    case 'Quad':
      return `<<(${termToString(term.subject)} ${termToString(term.predicate)} ${termToString(term.object)})>>`;
  }
}

const ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
};

function escapeString(value: string): string {
  return value.replaceAll(/[\\"\n\r\t\b\f]/gu, character => ESCAPES[character]!);
}
