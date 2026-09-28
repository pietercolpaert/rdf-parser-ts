#!/usr/bin/env node
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/index.ts
import { Transform } from "readable-stream";
function sameTerm(a, b) {
  if (!b || a.termType !== b.termType || a.value !== b.value) {
    return false;
  }
  if (a.termType === "Literal" && b.termType === "Literal") {
    return a.language === b.language && a.direction === b.direction && a.datatype.equals(b.datatype);
  }
  if (a.termType === "Quad" && b.termType === "Quad") {
    return a.subject.equals(b.subject) && a.predicate.equals(b.predicate) && a.object.equals(b.object) && a.graph.equals(b.graph);
  }
  return true;
}
function isDirectionalLanguage(value) {
  return Boolean(value && typeof value === "object" && "language" in value && !("termType" in value));
}
function fromTerm(original) {
  switch (original.termType) {
    case "NamedNode":
      return new NamedNode(original.value);
    case "BlankNode":
      return new BlankNode(original.value);
    case "Variable":
      return new Variable(original.value);
    case "DefaultGraph":
      return defaultGraphSingleton;
    case "Literal":
      return new Literal(
        original.value,
        original.language,
        fromTerm(original.datatype),
        original.direction ?? void 0
      );
    case "Quad":
      return new Quad(
        fromTerm(original.subject),
        fromTerm(original.predicate),
        fromTerm(original.object),
        fromTerm(original.graph)
      );
  }
}
function scanCommentEnd(input, index) {
  for (let i = index + 1; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 10) {
      return i + 1;
    }
    if (code === 13) {
      return input.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
    }
  }
  return -1;
}
function scanTrailingTriviaEnd(input, index) {
  let i = index;
  while (i < input.length) {
    const code = input.charCodeAt(i);
    if (isWs(code)) {
      i++;
      continue;
    }
    if (code === 35) {
      const end = scanCommentEnd(input, i);
      if (end < 0) {
        return i;
      }
      i = end;
      continue;
    }
    break;
  }
  return i;
}
function hasScheme(iri) {
  return /^[A-Za-z][\d+.A-Za-z-]*:/u.test(iri);
}
function hasColonInFirstSegment(iri) {
  const colon = iri.indexOf(":");
  if (colon < 0) {
    return false;
  }
  const end = iri.search(/[#/?]/u);
  return end < 0 || colon < end;
}
function parseBase(iri) {
  if (lastBase?.iri === iri) {
    return lastBase;
  }
  const match = /^([A-Za-z][\d+.A-Za-z-]*:)(\/\/[^#/?]*)?([^#?]*)(\?[^#]*)?/u.exec(iri);
  if (!match) {
    return void 0;
  }
  lastBase = {
    iri,
    prefix: match[1] + (match[2] ?? ""),
    hasAuthority: match[2] !== void 0,
    path: match[3],
    query: match[4] ?? ""
  };
  return lastBase;
}
function resolveIri(value, baseIRI) {
  if (!baseIRI || hasScheme(value)) {
    return value;
  }
  const base = parseBase(baseIRI);
  if (!base) {
    return value;
  }
  const first = value.charCodeAt(0);
  if (first === 47 && value.charCodeAt(1) === 47) {
    const authorityEnd = value.slice(2).search(/[#/?]/u);
    if (authorityEnd < 0) {
      return base.prefix.slice(0, base.prefix.indexOf(":") + 1) + value;
    }
    const pathStart = authorityEnd + 2;
    return base.prefix.slice(0, base.prefix.indexOf(":") + 1) + value.slice(0, pathStart) + removeDotSegmentsOfReference(value.slice(pathStart));
  }
  if (Number.isNaN(first) || first === 35) {
    return base.prefix + base.path + base.query + value;
  }
  if (first === 63) {
    return base.prefix + base.path + value;
  }
  if (first === 47) {
    return base.prefix + removeDotSegmentsOfReference(value);
  }
  const directory = base.hasAuthority && base.path === "" ? "/" : base.path.slice(0, base.path.lastIndexOf("/") + 1);
  return base.prefix + removeDotSegmentsOfReference(directory + value);
}
function removeDotSegmentsOfReference(reference) {
  const pathEnd = reference.search(/[#?]/u);
  if (pathEnd < 0) {
    return removeDotSegments(reference);
  }
  return removeDotSegments(reference.slice(0, pathEnd)) + reference.slice(pathEnd);
}
function removeDotSegments(path) {
  if (!path.includes(".")) {
    return path;
  }
  let input = path;
  let output = "";
  while (input.length > 0) {
    if (input.startsWith("../")) {
      input = input.slice(3);
    } else if (input.startsWith("./") || input.startsWith("/./")) {
      input = input.slice(2);
    } else if (input === "/.") {
      input = "/";
    } else if (input.startsWith("/../") || input === "/..") {
      input = input === "/.." ? "/" : input.slice(3);
      output = output.slice(0, Math.max(0, output.lastIndexOf("/")));
    } else if (input === "." || input === "..") {
      input = "";
    } else {
      const segmentEnd = input.indexOf("/", 1);
      const segment = segmentEnd < 0 ? input : input.slice(0, segmentEnd);
      output += segment;
      input = input.slice(segment.length);
    }
  }
  return output;
}
function isMessagesVersion(version) {
  return typeof version === "string" && version.toLowerCase().endsWith("-messages");
}
function isDotTerminator(next) {
  return Number.isNaN(next) || isWs(next) || next === 59 || next === 44 || next === 125 || next === 93 || next === 41;
}
function isWs(code) {
  return code === 32 || code === 9 || code === 10 || code === 13;
}
function isInvalidIriChar(code) {
  return code <= 32 || code === 34 || code === 60 || code === 62 || code === 94 || code === 96 || code === 123 || code === 124 || code === 125;
}
function isNameChar(code) {
  return code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 95 || code === 45 || code === 46;
}
function isAsciiLetter(code) {
  return code >= 65 && code <= 90 || code >= 97 && code <= 122;
}
function isWordBoundaryBlocker(code) {
  return isNameChar(code) || code === 58 || code >= 128;
}
function isPrefixStart(code) {
  return code === 58 || code === 95 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 128;
}
function isPnCharsBase(cp) {
  return cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122 || cp >= 192 && cp <= 214 || cp >= 216 && cp <= 246 || cp >= 248 && cp <= 767 || cp >= 880 && cp <= 893 || cp >= 895 && cp <= 8191 || cp === 8204 || cp === 8205 || cp >= 8304 && cp <= 8591 || cp >= 11264 && cp <= 12271 || cp >= 12289 && cp <= 55295 || cp >= 63744 && cp <= 64975 || cp >= 65008 && cp <= 65533 || cp >= 65536 && cp <= 983039;
}
function isPnChars(cp) {
  return cp === 95 || cp === 45 || cp >= 48 && cp <= 57 || isPnCharsBase(cp) || cp === 183 || cp >= 768 && cp <= 879 || cp === 8255 || cp === 8256;
}
function isNameStart(cp, kind) {
  if (kind === NAME_PREFIX) {
    return isPnCharsBase(cp);
  }
  return cp === 95 || cp >= 48 && cp <= 57 || isPnCharsBase(cp) || kind === NAME_LOCAL && cp === 58;
}
function isNamePart(cp, kind) {
  return cp === 46 || isPnChars(cp) || kind === NAME_LOCAL && cp === 58;
}
function isLanguageTagValid(tag) {
  const directionalSeparator = tag.indexOf("--");
  const language = directionalSeparator >= 0 ? tag.slice(0, directionalSeparator) : tag;
  const direction = directionalSeparator >= 0 ? tag.slice(directionalSeparator + 2) : "";
  const first = language.charCodeAt(0);
  if (!(first >= 65 && first <= 90 || first >= 97 && first <= 122)) {
    return false;
  }
  for (const subtag of language.split("-")) {
    if (!subtag || subtag.length > 8) {
      return false;
    }
  }
  return directionalSeparator < 0 || direction === "ltr" || direction === "rtl";
}
function isMessageQuad(value) {
  return Boolean(value && typeof value === "object" && "quad" in value && "messageCounter" in value);
}
function toMessages(output, messageCount) {
  const messages = [];
  const parsedMessageCount = messageCount ?? getMessageCount(output);
  for (const item of output) {
    const entry = isMessageQuad(item) ? item : { quad: item, messageCounter: 0 };
    while (messages.length <= entry.messageCounter) {
      messages.push(new Message(messages.length));
    }
    messages[entry.messageCounter].push(entry.quad);
  }
  if (parsedMessageCount !== void 0) {
    while (messages.length < parsedMessageCount) {
      messages.push(new Message(messages.length));
    }
  }
  return messages;
}
function getMessageCount(output) {
  if (!Array.isArray(output) || !("messageCount" in output)) {
    return void 0;
  }
  const value = output.messageCount;
  return typeof value === "number" ? value : void 0;
}
var XSD, RDF_NS, RDF_TYPE, RDF_REIFIES, RDF_FIRST, RDF_REST, RDF_NIL, RDF_LANG_STRING, RDF_DIR_LANG_STRING, XSD_STRING, XSD_INTEGER, XSD_DECIMAL, XSD_DOUBLE, XSD_BOOLEAN, NamedNode, BlankNode, Variable, DefaultGraph, Literal, Quad, Message, defaultGraphSingleton, globalBlankNodeCounter, DataFactory, Parser, CoreParser, SUPPORTED_VERSIONS, lastBase, NAME_PREFIX, NAME_LOCAL, NAME_BLANK_NODE_LABEL, LOCAL_NAME_ESCAPES, namedNode, blankNode, literal, variable, defaultGraph, quad;
var init_index = __esm({
  "src/index.ts"() {
    "use strict";
    XSD = "http://www.w3.org/2001/XMLSchema#";
    RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    RDF_TYPE = `${RDF_NS}type`;
    RDF_REIFIES = `${RDF_NS}reifies`;
    RDF_FIRST = `${RDF_NS}first`;
    RDF_REST = `${RDF_NS}rest`;
    RDF_NIL = `${RDF_NS}nil`;
    RDF_LANG_STRING = `${RDF_NS}langString`;
    RDF_DIR_LANG_STRING = `${RDF_NS}dirLangString`;
    XSD_STRING = `${XSD}string`;
    XSD_INTEGER = `${XSD}integer`;
    XSD_DECIMAL = `${XSD}decimal`;
    XSD_DOUBLE = `${XSD}double`;
    XSD_BOOLEAN = `${XSD}boolean`;
    NamedNode = class {
      constructor(value) {
        this.value = value;
      }
      value;
      termType = "NamedNode";
      equals(other) {
        return sameTerm(this, other);
      }
    };
    BlankNode = class {
      constructor(value) {
        this.value = value;
      }
      value;
      termType = "BlankNode";
      equals(other) {
        return sameTerm(this, other);
      }
    };
    Variable = class {
      constructor(value) {
        this.value = value;
      }
      value;
      termType = "Variable";
      equals(other) {
        return sameTerm(this, other);
      }
    };
    DefaultGraph = class {
      termType = "DefaultGraph";
      value = "";
      equals(other) {
        return sameTerm(this, other);
      }
    };
    Literal = class {
      constructor(value, language = "", datatype = new NamedNode(language ? RDF_LANG_STRING : XSD_STRING), direction) {
        this.value = value;
        this.language = language;
        this.datatype = datatype;
        if (direction) {
          this.direction = direction;
        }
      }
      value;
      language;
      datatype;
      termType = "Literal";
      direction;
      equals(other) {
        return sameTerm(this, other);
      }
    };
    Quad = class {
      constructor(subject, predicate, object, graph = defaultGraphSingleton) {
        this.subject = subject;
        this.predicate = predicate;
        this.object = object;
        this.graph = graph;
      }
      subject;
      predicate;
      object;
      graph;
      termType = "Quad";
      value = "";
      equals(other) {
        return sameTerm(this, other);
      }
    };
    Message = class _Message extends Array {
      constructor(messageCounter, quads = []) {
        super();
        this.messageCounter = messageCounter;
        Object.setPrototypeOf(this, _Message.prototype);
        for (const quad2 of quads) {
          this.push(quad2);
        }
      }
      messageCounter;
      static get [Symbol.species]() {
        return Array;
      }
    };
    defaultGraphSingleton = new DefaultGraph();
    globalBlankNodeCounter = 0;
    DataFactory = {
      namedNode: (value) => new NamedNode(value),
      blankNode: (value) => new BlankNode(value ?? `b${globalBlankNodeCounter++}`),
      literal: (value, languageOrDatatype) => {
        if (typeof languageOrDatatype === "string") {
          const language = languageOrDatatype.toLowerCase();
          return new Literal(value, language, new NamedNode(language ? RDF_LANG_STRING : XSD_STRING));
        }
        if (isDirectionalLanguage(languageOrDatatype)) {
          const direction = languageOrDatatype.direction ?? void 0;
          return new Literal(
            value,
            languageOrDatatype.language.toLowerCase(),
            new NamedNode(direction ? RDF_DIR_LANG_STRING : RDF_LANG_STRING),
            direction
          );
        }
        return new Literal(value, "", languageOrDatatype ?? new NamedNode(XSD_STRING));
      },
      variable: (value) => new Variable(value),
      defaultGraph: () => defaultGraphSingleton,
      quad: (subject, predicate, object, graph = defaultGraphSingleton) => new Quad(subject, predicate, object, graph),
      fromTerm,
      fromQuad: (original) => fromTerm(original)
    };
    Parser = class {
      options;
      constructor(options = {}) {
        this.options = options;
      }
      /**
       * Parses `input` and returns all quads, or `{ quad, messageCounter }` entries in RDF Messages mode.
       * When a callback is passed, it is called once per quad, then once with `quad === null`, and nothing is returned.
       */
      parse(input, callback) {
        try {
          const result = new CoreParser(input, this.options, {}).parse();
          if (callback) {
            if (result.messagesEnabled) {
              for (const entry of result.messageQuads) {
                callback(null, entry.quad, result.prefixes, entry.messageCounter);
              }
            } else {
              for (const quad2 of result.quads) {
                callback(null, quad2, result.prefixes);
              }
            }
            callback(null, null, result.prefixes);
            return void 0;
          }
          return result.messagesEnabled ? result.messageQuads : result.quads;
        } catch (error) {
          if (callback) {
            callback(error instanceof Error ? error : new Error(String(error)));
            return void 0;
          }
          throw error;
        }
      }
      /** Parses `input` in RDF Messages mode and groups the quads per message. */
      parseMessages(input) {
        const result = new CoreParser(input, { ...this.options, rdfMessages: true }, {}).parse();
        return toMessages(result.messageQuads);
      }
    };
    CoreParser = class {
      input;
      length;
      index = 0;
      line;
      factory;
      prefixes;
      quads = [];
      messageQuads = Object.assign([], { messageCount: 0 });
      callbacks;
      strictNTriples;
      /** Whether the format is N-Triples or N-Quads, which enables the strict line-based grammar. */
      strictLineFormat;
      allowDotlessGraphTerminator;
      /** Whether graph blocks are allowed (TriG, and the format-agnostic default). */
      allowGraphs;
      /** Whether `subject predicate object graph .` statements are allowed (N-Quads, and the default). */
      allowQuadStatements;
      parseUnsupportedVersions;
      relax;
      defaultGraphTerm;
      namedNodeCache;
      blankNodeLabels;
      baseIRI;
      version;
      messagesEnabled;
      messageCounter = 0;
      messageCountHint = 0;
      afterMessageDelimiter = false;
      localBlankNodeCounter = 0;
      fastEnd = 0;
      constructor(input, options, callbacks, state) {
        this.input = state ? input : input.charCodeAt(0) === 65279 ? input.slice(1) : input;
        this.length = this.input.length;
        this.factory = options.factory ?? DataFactory;
        this.prefixes = state?.prefixes ?? /* @__PURE__ */ Object.create(null);
        this.baseIRI = state?.baseIRI ?? options.baseIRI ?? options.baseIRIPath ?? "";
        this.callbacks = callbacks;
        this.relax = options.relax === true;
        this.defaultGraphTerm = this.factory.defaultGraph();
        this.version = state?.version ?? options.version;
        this.messagesEnabled = state?.messagesEnabled ?? (options.rdfMessages === true || options.messages === true || isMessagesVersion(options.version));
        this.messageCounter = state?.messageCounter ?? 0;
        this.messageCountHint = state?.messageCountHint ?? 0;
        this.afterMessageDelimiter = state?.afterMessageDelimiter ?? false;
        this.localBlankNodeCounter = state?.localBlankNodeCounter ?? 0;
        this.line = state?.line ?? 1;
        this.blankNodeLabels = state?.blankNodeLabels ?? /* @__PURE__ */ new Map();
        this.namedNodeCache = state?.namedNodeCache ?? /* @__PURE__ */ new Map();
        const format = typeof options.format === "string" ? options.format.toLowerCase() : "";
        this.strictNTriples = format.includes("n-triples");
        this.strictLineFormat = this.strictNTriples || format.includes("n-quads");
        this.allowDotlessGraphTerminator = format === "" || format.includes("trig");
        this.allowGraphs = !this.strictNTriples && !format.includes("turtle");
        this.allowQuadStatements = format === "" || format.includes("n-quads");
        this.parseUnsupportedVersions = options.parseUnsupportedVersions === true;
      }
      parse(final = true) {
        while (true) {
          this.skipWsAndComments();
          if (this.index >= this.length) {
            if (final) {
              this.finalizeEndOfFileMessage();
            }
            return {
              quads: this.quads,
              messageQuads: this.messageQuads,
              prefixes: this.prefixes,
              messagesEnabled: this.messagesEnabled
            };
          }
          if (this.strictLineFormat && this.tryParseLineStatementFast()) {
            continue;
          }
          this.parseStatement(this.defaultGraphTerm);
        }
      }
      exportState() {
        return {
          prefixes: this.prefixes,
          baseIRI: this.baseIRI,
          version: this.version,
          messagesEnabled: this.messagesEnabled,
          messageCounter: this.messageCounter,
          messageCountHint: this.messageCountHint,
          afterMessageDelimiter: this.afterMessageDelimiter,
          localBlankNodeCounter: this.localBlankNodeCounter,
          line: this.line,
          blankNodeLabels: this.blankNodeLabels,
          namedNodeCache: this.namedNodeCache
        };
      }
      tryParseLineStatementFast() {
        let i = this.index;
        const subject = this.readFastNode(i, false);
        if (!subject) {
          return false;
        }
        i = this.skipHws(this.fastEnd);
        const predicateEnd = this.readFastIriEnd(i);
        if (predicateEnd < 0) {
          return false;
        }
        const predicate = this.cachedNamedNode(this.input.slice(i + 1, predicateEnd));
        i = this.skipHws(predicateEnd + 1);
        const object = this.readFastObject(i);
        if (!object) {
          return false;
        }
        i = this.skipHws(this.fastEnd);
        let graph = this.defaultGraphTerm;
        const graphStart = this.input.charCodeAt(i);
        if (graphStart === 60 || graphStart === 95 && this.input.charCodeAt(i + 1) === 58) {
          if (this.strictNTriples) {
            return false;
          }
          const graphTerm = this.readFastNode(i, true);
          if (!graphTerm) {
            return false;
          }
          graph = graphTerm;
          i = this.skipHws(this.fastEnd);
        }
        if (this.input.charCodeAt(i) !== 46) {
          return false;
        }
        this.index = i + 1;
        this.addQuad(subject, predicate, object, graph);
        return true;
      }
      readFastObject(index) {
        const code = this.input.charCodeAt(index);
        if (code === 60) {
          if (this.input.charCodeAt(index + 1) === 60) {
            return this.relax ? this.readFastTripleTerm(index) : null;
          }
          const end = this.readFastIriEnd(index);
          if (end < 0) {
            return null;
          }
          this.fastEnd = end + 1;
          return this.factory.namedNode(this.input.slice(index + 1, end));
        }
        if (code === 95 && this.input.charCodeAt(index + 1) === 58) {
          return this.readFastBlankNode(index);
        }
        if (code === 34) {
          return this.readFastLiteral(index);
        }
        return null;
      }
      readFastTripleTerm(index) {
        let i = index + 2;
        i = this.skipHws(i);
        if (this.input.charCodeAt(i) !== 40) {
          return null;
        }
        i = this.skipHws(i + 1);
        const subject = this.readFastNode(i, false);
        if (!subject) {
          return null;
        }
        i = this.skipHws(this.fastEnd);
        const predicateEnd = this.readFastIriEnd(i);
        if (predicateEnd < 0) {
          return null;
        }
        const predicate = this.cachedNamedNode(this.input.slice(i + 1, predicateEnd));
        i = this.skipHws(predicateEnd + 1);
        const object = this.readFastObject(i);
        if (!object) {
          return null;
        }
        i = this.skipHws(this.fastEnd);
        if (this.input.charCodeAt(i) !== 41 || this.input.charCodeAt(i + 1) !== 62 || this.input.charCodeAt(i + 2) !== 62) {
          return null;
        }
        this.fastEnd = i + 3;
        return this.factory.quad(subject, predicate, object, this.factory.defaultGraph());
      }
      readFastNode(index, cache) {
        const code = this.input.charCodeAt(index);
        if (code === 60) {
          if (this.input.charCodeAt(index + 1) === 60) {
            return null;
          }
          const end = this.readFastIriEnd(index);
          if (end < 0) {
            return null;
          }
          this.fastEnd = end + 1;
          const value = this.input.slice(index + 1, end);
          return cache ? this.cachedNamedNode(value) : this.factory.namedNode(value);
        }
        if (code === 95 && this.input.charCodeAt(index + 1) === 58) {
          return this.readFastBlankNode(index);
        }
        return null;
      }
      readFastBlankNode(index) {
        let i = index + 2;
        const start = i;
        while (i < this.length) {
          const code = this.input.charCodeAt(i);
          if (!isNameChar(code)) {
            break;
          }
          if (code === 46) {
            const next = this.input.charCodeAt(i + 1);
            if (isDotTerminator(next)) {
              break;
            }
          }
          i++;
        }
        if (i === start) {
          return null;
        }
        this.fastEnd = i;
        return this.blankNodeFromLabel(this.input.slice(start, i));
      }
      readFastLiteral(index) {
        const end = this.input.indexOf('"', index + 1);
        if (end < 0) {
          return null;
        }
        for (let i2 = index + 1; i2 < end; i2++) {
          const code = this.input.charCodeAt(i2);
          if (code === 92 || code === 10 || code === 13) {
            return null;
          }
        }
        const value = this.input.slice(index + 1, end);
        let i = end + 1;
        const next = this.input.charCodeAt(i);
        if (next === 64) {
          const start = ++i;
          while (i < this.length) {
            const code = this.input.charCodeAt(i);
            if (code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 45) {
              i++;
            } else {
              break;
            }
          }
          if (i === start) {
            return null;
          }
          const tag = this.input.slice(start, i);
          if (!this.relax && !isLanguageTagValid(tag)) {
            return null;
          }
          this.fastEnd = i;
          return this.languageLiteral(value, tag);
        }
        if (next === 94 && this.input.charCodeAt(i + 1) === 94) {
          i += 2;
          const datatypeEnd = this.readFastIriEnd(i);
          if (datatypeEnd < 0) {
            return null;
          }
          const datatypeValue = this.input.slice(i + 1, datatypeEnd);
          if (!this.relax && (datatypeValue === RDF_LANG_STRING || datatypeValue === RDF_DIR_LANG_STRING)) {
            return null;
          }
          this.fastEnd = datatypeEnd + 1;
          return this.factory.literal(value, this.cachedNamedNode(datatypeValue));
        }
        this.fastEnd = i;
        return this.factory.literal(value);
      }
      readFastIriEnd(index) {
        if (this.input.charCodeAt(index) !== 60) {
          return -1;
        }
        const end = this.input.indexOf(">", index + 1);
        if (end < 0) {
          return -1;
        }
        if (this.relax) {
          return end;
        }
        let hasScheme2 = false;
        for (let i = index + 1; i < end; i++) {
          const code = this.input.charCodeAt(i);
          if (code === 58 && i > index + 1) {
            hasScheme2 = true;
          }
          if (code <= 32 || code === 34 || code === 60 || code === 92 || code === 94 || code === 96 || code === 123 || code === 124 || code === 125) {
            return -1;
          }
        }
        return hasScheme2 ? end : -1;
      }
      skipHws(index) {
        while (index < this.length) {
          const code = this.input.charCodeAt(index);
          if (code !== 32 && code !== 9) {
            break;
          }
          index++;
        }
        return index;
      }
      cachedNamedNode(value) {
        const cached = this.namedNodeCache.get(value);
        if (cached) {
          return cached;
        }
        const node = this.factory.namedNode(value);
        if (this.namedNodeCache.size < 4096) {
          this.namedNodeCache.set(value, node);
        }
        return node;
      }
      parseStatement(defaultGraph2, allowGraphCloseTerminator = false, insideGraphBlock = false) {
        this.skipWsAndComments();
        if (this.parseDirective(defaultGraph2)) {
          if (insideGraphBlock) {
            this.fail("Directives are not allowed inside graph blocks");
          }
          return false;
        }
        if (this.peekCharCode() === 123) {
          this.assertGraphBlockAllowed(insideGraphBlock);
          this.index++;
          this.parseGraphStatements(defaultGraph2);
          return false;
        }
        if (this.allowGraphs && this.matchWord("GRAPH")) {
          if (insideGraphBlock) {
            this.fail("Graph blocks are not allowed inside graph blocks");
          }
          this.skipWsAndComments();
          const graph = this.parseGraphLabel(defaultGraph2);
          this.skipWsAndComments();
          this.expectChar(123, "Expected { after GRAPH label");
          this.parseGraphStatements(graph);
          return false;
        }
        const termStart = this.index;
        const subjectOrGraph = this.parseSubject(defaultGraph2);
        const termEnd = this.index;
        this.skipWsAndComments();
        if (this.peekCharCode() === 123) {
          this.assertGraphBlockAllowed(insideGraphBlock);
          this.assertGraphLabel(subjectOrGraph, termStart, termEnd);
          this.index++;
          this.parseGraphStatements(subjectOrGraph);
          return false;
        }
        if (this.isBlankNodePropertyListSubject(termStart, termEnd) || this.isReifiedTripleSubject(termStart, subjectOrGraph)) {
          if (this.peekCharCode() === 46) {
            this.index++;
            return false;
          }
          if (allowGraphCloseTerminator && this.peekCharCode() === 125) {
            return true;
          }
        }
        return this.parsePredicateObjectList(subjectOrGraph, defaultGraph2, 46, allowGraphCloseTerminator);
      }
      assertGraphBlockAllowed(insideGraphBlock) {
        if (insideGraphBlock) {
          this.fail("Graph blocks are not allowed inside graph blocks");
        }
        if (!this.allowGraphs) {
          this.fail("Graph blocks are not allowed in this format");
        }
      }
      parseGraphStatements(graph) {
        let lastStatementClosedByGraph = false;
        while (true) {
          this.skipWsAndComments();
          if (this.index >= this.length) {
            this.fail("Unclosed graph block");
          }
          if (this.peekCharCode() === 125) {
            this.index++;
            this.skipWsAndComments();
            if (lastStatementClosedByGraph && this.peekCharCode() === 46) {
              this.fail("Expected . after triple");
            }
            if (this.peekCharCode() === 46) {
              this.index++;
            }
            return;
          }
          lastStatementClosedByGraph = this.parseStatement(graph, this.allowDotlessGraphTerminator, true);
        }
      }
      parsePredicateObjectList(subject, graph, terminatorCode = 46, allowGraphCloseTerminator = false) {
        while (true) {
          const predicate = this.parsePredicate(graph);
          this.skipWsAndComments();
          while (true) {
            const object = this.parseObject(graph);
            this.skipWsAndComments();
            if (terminatorCode === 46 && !allowGraphCloseTerminator && graph.termType === "DefaultGraph" && this.canStartTerm() && !this.nextIsStatementBoundary()) {
              if (!this.allowQuadStatements) {
                this.fail(`Graph terms are not allowed in ${this.strictNTriples ? "N-Triples" : "this format"}`);
              }
              const explicitGraph = this.parseNamedOrBlankTerm(graph);
              this.addQuad(subject, predicate, object, explicitGraph);
              this.skipWsAndComments();
              this.expectChar(46, "Expected . after quad");
              return false;
            }
            this.addQuad(subject, predicate, object, graph);
            this.parseAnnotations(subject, predicate, object, graph);
            if (this.peekCharCode() !== 44) {
              break;
            }
            if (this.strictLineFormat) {
              this.fail("Object lists are not allowed in this format");
            }
            this.index++;
            this.skipWsAndComments();
          }
          if (this.peekCharCode() !== 59) {
            break;
          }
          if (this.strictLineFormat) {
            this.fail("Predicate lists are not allowed in this format");
          }
          do {
            this.index++;
            this.skipWsAndComments();
          } while (this.peekCharCode() === 59);
          if (this.peekCharCode() === terminatorCode || allowGraphCloseTerminator && this.peekCharCode() === 125) {
            break;
          }
        }
        if (allowGraphCloseTerminator && this.peekCharCode() === 125) {
          return true;
        }
        if (terminatorCode === 46) {
          this.expectChar(46, "Expected . after triple");
        } else if (this.peekCharCode() !== terminatorCode) {
          this.fail(`Expected ${String.fromCharCode(terminatorCode)} after property list`);
        }
        return false;
      }
      /**
       * Parses the RDF 1.2 annotations following an object: reifiers (`~ reifier`) and annotation blocks
       * (`{| predicateObjectList |}`). An annotation block describes the reifier directly before it, or a fresh
       * blank node reifier when there is none.
       */
      parseAnnotations(subject, predicate, object, graph) {
        let tripleTerm;
        let reifier;
        while (true) {
          const code = this.peekCharCode();
          const annotationBlock = code === 123 && this.input.charCodeAt(this.index + 1) === 124;
          if (code !== 126 && !annotationBlock) {
            return;
          }
          if (this.strictLineFormat) {
            this.fail("Annotations are not allowed in this format");
          }
          tripleTerm ??= this.factory.quad(subject, predicate, object, this.factory.defaultGraph());
          if (annotationBlock) {
            this.index += 2;
            this.skipWsAndComments();
            if (!reifier) {
              reifier = this.createFreshBlankNode();
              this.addQuad(reifier, this.factory.namedNode(RDF_REIFIES), tripleTerm, graph);
            }
            this.parsePredicateObjectList(reifier, graph, 124);
            if (this.input.charCodeAt(this.index + 1) !== 125) {
              this.fail("Expected |} after annotation block");
            }
            this.index += 2;
            reifier = void 0;
          } else {
            this.index++;
            reifier = this.parseOptionalReifier(graph);
            this.addQuad(reifier, this.factory.namedNode(RDF_REIFIES), tripleTerm, graph);
          }
          this.skipWsAndComments();
        }
      }
      addQuad(subject, predicate, object, graph) {
        const quad2 = this.factory.quad(subject, predicate, object, graph);
        this.quads.push(quad2);
        if (this.messagesEnabled) {
          this.messageQuads.push({ quad: quad2, messageCounter: this.messageCounter });
          this.messageCountHint = Math.max(this.messageCountHint, this.messageCounter + 1);
          this.afterMessageDelimiter = false;
        }
      }
      parseDirective(currentGraph) {
        const start = this.index;
        if (this.peekCharCode() === 64) {
          if (this.strictLineFormat) {
            this.fail("Directives are not allowed in this format");
          }
          let end = start + 1;
          while (isAsciiLetter(this.input.charCodeAt(end))) {
            end++;
          }
          const keyword = this.input.slice(start + 1, end);
          if (keyword !== "version" && keyword !== "prefix" && keyword !== "base" && keyword !== "message") {
            return false;
          }
          this.index = end;
          if (keyword === "version") {
            this.parseVersionDirective(true);
          } else if (keyword === "prefix") {
            this.parsePrefixDirective(true);
          } else if (keyword === "base") {
            this.parseBaseDirective(true);
          } else {
            this.parseMessageDirective(true, currentGraph);
          }
          return true;
        }
        if (this.matchWord("VERSION")) {
          this.parseVersionDirective(false);
          return true;
        }
        if (this.matchWord("MESSAGE")) {
          this.parseMessageDirective(false, currentGraph);
          return true;
        }
        if (this.matchWord("PREFIX")) {
          if (this.strictLineFormat) {
            this.fail("Directives are not allowed in this format");
          }
          this.parsePrefixDirective(false);
          return true;
        }
        if (this.matchWord("BASE")) {
          if (this.strictLineFormat) {
            this.fail("Directives are not allowed in this format");
          }
          this.parseBaseDirective(false);
          return true;
        }
        return false;
      }
      parseVersionDirective(needsDot) {
        this.skipWsAndComments();
        const quote = this.peekCharCode();
        if (quote !== 34 && quote !== 39) {
          this.fail("Expected a version string");
        }
        if (this.input.charCodeAt(this.index + 1) === quote && this.input.charCodeAt(this.index + 2) === quote) {
          this.fail("Version labels must not use long strings");
        }
        this.version = this.readQuotedString();
        if (!this.parseUnsupportedVersions && !SUPPORTED_VERSIONS.has(this.version) && !isMessagesVersion(this.version)) {
          this.fail(`Unsupported version "${this.version}"`);
        }
        if (isMessagesVersion(this.version)) {
          this.messagesEnabled = true;
        }
        this.skipWsAndComments();
        if (needsDot) {
          this.expectChar(46, "Expected . after version directive");
        }
      }
      parseMessageDirective(needsDot, currentGraph) {
        if (!this.messagesEnabled) {
          this.fail("RDF Messages are not enabled");
        }
        if (currentGraph.termType !== "DefaultGraph") {
          this.fail("Message delimiters are not allowed inside graph blocks");
        }
        this.skipWsAndComments();
        if (needsDot) {
          this.expectChar(46, "Expected . after message directive");
        }
        this.finishMessage();
      }
      parsePrefixDirective(needsDot) {
        this.skipWsAndComments();
        const prefix = this.readName(NAME_PREFIX);
        this.expectChar(58, "Expected : after prefix label");
        this.skipWsAndComments();
        const iri = this.parseIri();
        this.prefixes[prefix] = iri;
        this.callbacks.prefix?.(prefix, iri);
        this.skipWsAndComments();
        if (needsDot) {
          this.expectChar(46, "Expected . after prefix directive");
        }
      }
      parseBaseDirective(needsDot) {
        this.skipWsAndComments();
        this.baseIRI = this.parseIri().value;
        this.skipWsAndComments();
        if (needsDot) {
          this.expectChar(46, "Expected . after base directive");
        }
      }
      parseSubject(graph) {
        const term = this.parseTerm(graph);
        if (term.termType === "Literal" || term.termType === "Quad") {
          this.fail(`Invalid subject term ${term.termType}`);
        }
        return term;
      }
      parseObject(graph) {
        return this.parseTerm(graph);
      }
      parsePredicate(graph) {
        if (this.matchWord("a", false, true)) {
          return this.factory.namedNode(RDF_TYPE);
        }
        const term = this.parseTerm(graph);
        if (term.termType !== "NamedNode") {
          this.fail(`Invalid predicate term ${term.termType}`);
        }
        return term;
      }
      parseNamedOrBlankTerm(graph) {
        const term = this.parseTerm(graph);
        if (term.termType !== "NamedNode" && term.termType !== "BlankNode") {
          this.fail(`Invalid graph term ${term.termType}`);
        }
        return term;
      }
      parseGraphLabel(graph) {
        const start = this.index;
        const term = this.parseNamedOrBlankTerm(graph);
        this.assertGraphLabel(term, start);
        return term;
      }
      /** Rejects graph labels that are syntactically not an IRI or blank node label, such as `[ <p> <o> ]` or `( )`. */
      assertGraphLabel(term, start, end = this.index) {
        const code = this.input.charCodeAt(start);
        if (code === 91 && !this.isAnonymousBlankNodeLabel(start, end) || code === 40 || code === 60 && this.input.charCodeAt(start + 1) === 60) {
          this.fail(`Invalid graph term ${term.termType}`);
        }
      }
      /** Whether the term in `[start, end)` is `[]`, possibly with whitespace and comments between the brackets. */
      isAnonymousBlankNodeLabel(start, end) {
        return this.input.charCodeAt(start) === 91 && this.input.charCodeAt(end - 1) === 93 && scanTrailingTriviaEnd(this.input, start + 1) === end - 1;
      }
      isReifiedTripleSubject(start, term) {
        return term.termType !== "Quad" && this.input.charCodeAt(start) === 60 && this.input.charCodeAt(start + 1) === 60;
      }
      isBlankNodePropertyListSubject(start, end) {
        return this.input.charCodeAt(start) === 91 && !this.isAnonymousBlankNodeLabel(start, end);
      }
      parseTerm(graph) {
        this.skipWsAndComments();
        const code = this.peekCharCode();
        if (code < 0) {
          this.fail("Unexpected end of input");
        }
        if (code === 60) {
          if (this.input.charCodeAt(this.index + 1) === 60) {
            return this.parseDoubleAngleTerm(graph);
          }
          return this.parseIri();
        }
        if (code === 34 || code === 39) {
          return this.parseLiteral();
        }
        if (code === 95 && this.input.charCodeAt(this.index + 1) === 58) {
          return this.parseBlankNode();
        }
        if (code === 91) {
          return this.parseBlankNodePropertyList(graph);
        }
        if (code === 40) {
          return this.parseCollection(graph);
        }
        const next = this.input.charCodeAt(this.index + 1);
        if (code === 43 || code === 45 || code >= 48 && code <= 57 || code === 46 && next >= 48 && next <= 57) {
          return this.parseNumber();
        }
        if (this.strictLineFormat && (this.matchWord("true", true, true) || this.matchWord("false", true, true))) {
          this.fail("Boolean literals are not allowed in this format");
        }
        if (this.matchWord("true", true, true)) {
          return this.factory.literal("true", this.factory.namedNode(XSD_BOOLEAN));
        }
        if (this.matchWord("false", true, true)) {
          return this.factory.literal("false", this.factory.namedNode(XSD_BOOLEAN));
        }
        return this.parsePrefixedName();
      }
      parseDoubleAngleTerm(graph) {
        this.index += 2;
        this.skipWsAndComments();
        if (this.peekCharCode() === 40) {
          return this.parseTripleTerm(graph);
        }
        if (this.strictLineFormat) {
          this.fail("Reified triples are not allowed in this format");
        }
        return this.parseReifiedTriple(graph);
      }
      parseTripleTerm(graph) {
        this.expectChar(40, "Expected ( after << in RDF1.2 triple term");
        const subject = this.parseSubject(graph);
        const predicate = this.parsePredicate(graph);
        const object = this.parseObject(graph);
        this.skipWsAndComments();
        this.expectChar(41, "Expected ) after triple term");
        this.skipWsAndComments();
        if (this.input.charCodeAt(this.index) !== 62 || this.input.charCodeAt(this.index + 1) !== 62) {
          this.fail("Expected >> after triple term");
        }
        this.index += 2;
        return this.factory.quad(subject, predicate, object, this.factory.defaultGraph());
      }
      parseReifiedTriple(graph) {
        const subject = this.parseReifiedTripleSubject(graph);
        const predicate = this.parsePredicate(graph);
        const object = this.parseReifiedTripleObject(graph);
        this.skipWsAndComments();
        const reifier = this.peekCharCode() === 126 ? this.parseReifier(graph) : this.createFreshBlankNode();
        this.skipWsAndComments();
        if (this.input.charCodeAt(this.index) !== 62 || this.input.charCodeAt(this.index + 1) !== 62) {
          this.fail("Expected >> after reified triple");
        }
        this.index += 2;
        const tripleTerm = this.factory.quad(subject, predicate, object, this.factory.defaultGraph());
        this.addQuad(reifier, this.factory.namedNode(RDF_REIFIES), tripleTerm, graph);
        return reifier;
      }
      parseReifiedTripleSubject(graph) {
        this.skipWsAndComments();
        const start = this.index;
        const term = this.parseTerm(graph);
        this.assertReifiedTripleTerm(term, start, "subject");
        if (term.termType === "Literal" || term.termType === "Quad") {
          this.fail(`Invalid reified triple subject term ${term.termType}`);
        }
        return term;
      }
      parseReifiedTripleObject(graph) {
        this.skipWsAndComments();
        const start = this.index;
        const term = this.parseTerm(graph);
        this.assertReifiedTripleTerm(term, start, "object");
        return term;
      }
      parseReifier(graph) {
        this.index++;
        return this.parseOptionalReifier(graph);
      }
      /** Parses the IRI or blank node after `~`, or creates a fresh blank node when it is omitted. */
      parseOptionalReifier(graph) {
        this.skipWsAndComments();
        const code = this.peekCharCode();
        if (!(code === 91 || isPrefixStart(code) || code === 60 && this.input.charCodeAt(this.index + 1) !== 60)) {
          return this.createFreshBlankNode();
        }
        const start = this.index;
        const term = this.parseTerm(graph);
        this.assertReifiedTripleTerm(term, start, "reifier");
        if (term.termType !== "NamedNode" && term.termType !== "BlankNode") {
          this.fail(`Invalid reifier term ${term.termType}`);
        }
        return term;
      }
      assertReifiedTripleTerm(term, start, position, end = this.index) {
        const code = this.input.charCodeAt(start);
        if (code === 40 || code === 91 && !this.isAnonymousBlankNodeLabel(start, end)) {
          this.fail(`Invalid reified triple ${position} term ${term.termType}`);
        }
      }
      parseIri() {
        this.expectChar(60, "Expected <");
        let value = "";
        while (this.index < this.length) {
          const code = this.peekCharCode();
          if (code === 62) {
            this.index++;
            if (!hasScheme(value)) {
              if (this.strictLineFormat) {
                this.fail("Relative IRIs are not allowed in this format");
              }
              if (hasColonInFirstSegment(value)) {
                this.fail("Invalid relative IRI: colon in first path segment");
              }
            }
            return this.factory.namedNode(resolveIri(value, this.baseIRI));
          }
          if (code === 92) {
            this.index++;
            const escapeCode = this.peekCharCode();
            if (this.strictLineFormat && escapeCode !== 117 && escapeCode !== 85) {
              this.fail("Only Unicode escapes are allowed in IRIs");
            }
            const escaped = this.readEscape();
            if (isInvalidIriChar(escaped.codePointAt(0))) {
              this.fail("Invalid character in IRI");
            }
            value += escaped;
            continue;
          }
          if (isInvalidIriChar(code)) {
            this.fail("Invalid character in IRI");
          }
          value += this.input[this.index];
          this.advanceOne();
        }
        this.fail("Unterminated IRI");
      }
      parseLiteral() {
        if (this.strictLineFormat && this.peekCharCode() !== 34) {
          this.fail("Only double-quoted literals are allowed in this format");
        }
        const value = this.readQuotedString();
        if (this.peekCharCode() === 64) {
          this.index++;
          const tag = this.readLanguageTag();
          return this.languageLiteral(value, tag);
        }
        if (this.peekCharCode() === 94 && this.input.charCodeAt(this.index + 1) === 94) {
          this.index += 2;
          const datatype = this.parseTerm(this.factory.defaultGraph());
          if (datatype.termType !== "NamedNode") {
            this.fail("Expected datatype IRI after ^^");
          }
          if (datatype.value === RDF_LANG_STRING || datatype.value === RDF_DIR_LANG_STRING) {
            this.fail("Language string datatypes require an explicit language tag");
          }
          return this.factory.literal(value, datatype);
        }
        return this.factory.literal(value);
      }
      /** Creates a literal from a language tag, which may carry an RDF 1.2 base direction (`en--ltr`). */
      languageLiteral(value, tag) {
        const directionalSeparator = tag.indexOf("--");
        if (directionalSeparator < 0) {
          return this.factory.literal(value, tag.toLowerCase());
        }
        return this.factory.literal(value, {
          language: tag.slice(0, directionalSeparator).toLowerCase(),
          direction: tag.slice(directionalSeparator + 2).toLowerCase()
        });
      }
      parseBlankNode() {
        this.index += 2;
        const label = this.readName(NAME_BLANK_NODE_LABEL);
        if (!label) {
          this.fail("Expected blank node label");
        }
        return this.blankNodeFromLabel(label);
      }
      parseBlankNodePropertyList(graph) {
        this.expectChar(91, "Expected [");
        const blank = this.createBlankNode(`b${this.localBlankNodeCounter++}`);
        this.skipWsAndComments();
        if (this.peekCharCode() === 93) {
          this.index++;
          return blank;
        }
        this.parsePredicateObjectList(blank, graph, 93);
        this.skipWsAndComments();
        this.expectChar(93, "Expected ] after blank node property list");
        return blank;
      }
      parseCollection(graph) {
        this.expectChar(40, "Expected (");
        this.skipWsAndComments();
        if (this.peekCharCode() === 41) {
          this.index++;
          return this.factory.namedNode(RDF_NIL);
        }
        const head = this.createBlankNode(`b${this.localBlankNodeCounter++}`);
        let current = head;
        while (true) {
          const item = this.parseObject(graph);
          this.addQuad(current, this.factory.namedNode(RDF_FIRST), item, graph);
          this.skipWsAndComments();
          if (this.peekCharCode() === 41) {
            this.index++;
            this.addQuad(current, this.factory.namedNode(RDF_REST), this.factory.namedNode(RDF_NIL), graph);
            return head;
          }
          const next = this.createBlankNode(`b${this.localBlankNodeCounter++}`);
          this.addQuad(current, this.factory.namedNode(RDF_REST), next, graph);
          current = next;
        }
      }
      blankNodeFromLabel(label) {
        if (!this.messagesEnabled) {
          return this.factory.blankNode(label);
        }
        const existing = this.blankNodeLabels.get(label);
        if (existing) {
          return existing;
        }
        const blank = this.createBlankNode(label);
        this.blankNodeLabels.set(label, blank);
        return blank;
      }
      createBlankNode(label) {
        return this.messagesEnabled ? this.factory.blankNode(`m${this.messageCounter}_${label}`) : this.factory.blankNode(label);
      }
      createFreshBlankNode() {
        return this.createBlankNode(`b${this.localBlankNodeCounter++}`);
      }
      finishMessage() {
        this.messageCountHint = Math.max(this.messageCountHint, this.messageCounter + 1);
        this.messageCounter++;
        this.afterMessageDelimiter = true;
        this.blankNodeLabels.clear();
        this.localBlankNodeCounter = 0;
      }
      finalizeEndOfFileMessage() {
        if (!this.messagesEnabled) {
          return;
        }
        if (!this.afterMessageDelimiter) {
          this.messageCountHint = Math.max(this.messageCountHint, this.messageCounter + 1);
        }
        this.messageQuads.messageCount = this.messageCountHint;
      }
      parseNumber() {
        if (this.strictLineFormat) {
          this.fail("Numeric literals are not allowed in this format");
        }
        const rest = this.input.slice(this.index);
        const match = /^[+-]?(?:(?:\d+\.\d*|\.\d+|\d+)[Ee][+-]?\d+|(?:\d*\.\d+)|\d+)/u.exec(rest);
        if (!match?.[0]) {
          this.fail("Invalid number");
        }
        const value = match[0];
        this.index += value.length;
        let datatype = XSD_INTEGER;
        if (/[Ee]/u.test(value)) {
          datatype = XSD_DOUBLE;
        } else if (value.includes(".")) {
          datatype = XSD_DECIMAL;
        }
        return this.factory.literal(value, this.factory.namedNode(datatype));
      }
      parsePrefixedName() {
        const prefix = this.readName(NAME_PREFIX);
        this.expectChar(58, "Expected prefixed name");
        const local = this.readName(NAME_LOCAL);
        const namespace = this.prefixes[prefix];
        if (!namespace) {
          this.fail(`Unknown prefix "${prefix}"`);
        }
        return this.factory.namedNode(namespace.value + local);
      }
      readQuotedString() {
        const quote = this.peekCharCode();
        const triple = this.input.charCodeAt(this.index + 1) === quote && this.input.charCodeAt(this.index + 2) === quote;
        if (this.strictLineFormat && triple) {
          this.fail("Long literals are not allowed in this format");
        }
        this.index += triple ? 3 : 1;
        let value = "";
        while (this.index < this.length) {
          const code = this.peekCharCode();
          if (code === quote) {
            if (triple) {
              if (this.input.charCodeAt(this.index + 1) === quote && this.input.charCodeAt(this.index + 2) === quote) {
                this.index += 3;
                return value;
              }
            } else {
              this.index++;
              return value;
            }
          }
          if (code === 92) {
            this.index++;
            value += this.readEscape();
            continue;
          }
          if (!triple && (code === 10 || code === 13)) {
            this.fail("Line breaks are not allowed in literals");
          }
          value += this.input[this.index];
          this.advanceOne();
        }
        this.fail("Unterminated literal");
      }
      readEscape() {
        const code = this.peekCharCode();
        if (code === 116) {
          this.index++;
          return "	";
        }
        if (code === 98) {
          this.index++;
          return "\b";
        }
        if (code === 110) {
          this.index++;
          return "\n";
        }
        if (code === 114) {
          this.index++;
          return "\r";
        }
        if (code === 102) {
          this.index++;
          return "\f";
        }
        if (code === 34 || code === 39 || code === 92) {
          this.index++;
          return String.fromCharCode(code);
        }
        if (code === 117 || code === 85) {
          const size = code === 117 ? 4 : 8;
          this.index++;
          const hex = this.input.slice(this.index, this.index + size);
          if (!/^[\dA-Fa-f]+$/u.test(hex) || hex.length !== size) {
            this.fail("Invalid Unicode escape");
          }
          this.index += size;
          const codePoint = Number.parseInt(hex, 16);
          if (codePoint >= 55296 && codePoint <= 57343) {
            this.fail("Unicode escapes must not encode surrogates");
          }
          return String.fromCodePoint(codePoint);
        }
        this.fail("Invalid escape sequence");
      }
      readLanguageTag() {
        const start = this.index;
        const first = this.peekCharCode();
        if (!(first >= 65 && first <= 90 || first >= 97 && first <= 122)) {
          this.fail("Expected language tag");
        }
        while (this.index < this.length) {
          const code = this.peekCharCode();
          if (code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 45) {
            this.index++;
          } else {
            break;
          }
        }
        const tag = this.input.slice(start, this.index);
        const directionalSeparator = tag.indexOf("--");
        const language = directionalSeparator >= 0 ? tag.slice(0, directionalSeparator) : tag;
        const direction = directionalSeparator >= 0 ? tag.slice(directionalSeparator + 2) : "";
        for (const subtag of language.split("-")) {
          if (!subtag || subtag.length > 8) {
            this.fail("Invalid language tag");
          }
        }
        if (directionalSeparator >= 0 && direction !== "ltr" && direction !== "rtl") {
          this.fail("Invalid base direction");
        }
        return tag.toLowerCase();
      }
      /**
       * Reads a PN_PREFIX, PN_LOCAL or BLANK_NODE_LABEL (without `_:`) and returns its value, with PN_LOCAL_ESC
       * escapes resolved. Names cannot end with `.`, so a trailing dot is left for the statement terminator.
       */
      readName(kind) {
        let i = this.index;
        let value = "";
        let end = i;
        let endValue = "";
        while (i < this.length) {
          const code = this.input.charCodeAt(i);
          if (kind === NAME_LOCAL && (code === 92 || code === 37)) {
            const escape = code === 92 ? this.input.slice(i, i + 2) : this.input.slice(i, i + 3);
            if (code === 92 ? !LOCAL_NAME_ESCAPES.has(escape.charAt(1)) : !/^%[\dA-Fa-f]{2}$/u.test(escape)) {
              this.index = i;
              this.fail(`Invalid ${code === 92 ? "escape" : "percent-encoding"} in local name`);
            }
            value += code === 92 ? escape.charAt(1) : escape;
            i += escape.length;
            end = i;
            endValue = value;
            continue;
          }
          const codePoint = code >= 55296 && code <= 56319 ? this.input.codePointAt(i) : code;
          if (!(i === this.index ? isNameStart(codePoint, kind) : isNamePart(codePoint, kind))) {
            break;
          }
          const width = codePoint > 65535 ? 2 : 1;
          value += this.input.slice(i, i + width);
          i += width;
          if (code !== 46) {
            end = i;
            endValue = value;
          }
        }
        this.index = end;
        return endValue;
      }
      skipWsAndComments() {
        while (this.index < this.length) {
          const code = this.peekCharCode();
          if (isWs(code)) {
            this.advanceOne();
            continue;
          }
          if (code === 35) {
            this.index++;
            const start = this.index;
            while (this.index < this.length) {
              const next = this.peekCharCode();
              if (next === 10 || next === 13) {
                break;
              }
              this.index++;
            }
            this.callbacks.comment?.(this.input.slice(start, this.index));
            continue;
          }
          return;
        }
      }
      matchWord(word, allowDotBoundary = false, caseSensitive = false) {
        if (this.input.length - this.index < word.length) {
          return false;
        }
        const candidate = this.input.slice(this.index, this.index + word.length);
        if (caseSensitive ? candidate !== word : candidate.toLowerCase() !== word.toLowerCase()) {
          return false;
        }
        const previous = this.index > 0 ? this.input.charCodeAt(this.index - 1) : -1;
        const next = this.input.charCodeAt(this.index + word.length);
        if (previous >= 0 && isWordBoundaryBlocker(previous) || isWordBoundaryBlocker(next) && !(allowDotBoundary && next === 46)) {
          return false;
        }
        this.index += word.length;
        return true;
      }
      canStartTerm() {
        const code = this.peekCharCode();
        return code === 60 || code === 95 || code === 91 || code === 40 || code === 34 || code === 39 || code === 43 || code === 45 || code >= 48 && code <= 57 || isPrefixStart(code);
      }
      nextIsStatementBoundary() {
        const code = this.peekCharCode();
        return code === 46 || code === 59 || code === 44 || code === 125 || code === 93 || code === 41 || code < 0;
      }
      expectChar(code, message) {
        this.skipWsAndComments();
        if (this.peekCharCode() !== code) {
          this.fail(message);
        }
        this.index++;
      }
      peekCharCode() {
        return this.index < this.length ? this.input.charCodeAt(this.index) : -1;
      }
      advanceOne() {
        if (this.input.charCodeAt(this.index) === 10) {
          this.line++;
        }
        this.index++;
      }
      fail(message) {
        const error = new Error(`${message} on line ${this.line}.`);
        error.context = { line: this.line, index: this.index };
        throw error;
      }
    };
    SUPPORTED_VERSIONS = /* @__PURE__ */ new Set(["1.1", "1.2", "1.2-basic"]);
    NAME_PREFIX = 0;
    NAME_LOCAL = 1;
    NAME_BLANK_NODE_LABEL = 2;
    LOCAL_NAME_ESCAPES = new Set("_~.-!$&'()*+,;=/?#@%");
    namedNode = DataFactory.namedNode;
    blankNode = DataFactory.blankNode;
    literal = DataFactory.literal;
    variable = DataFactory.variable;
    defaultGraph = DataFactory.defaultGraph;
    quad = DataFactory.quad;
  }
});

// src/serialize.ts
function quadToString(quad2) {
  const graph = quad2.graph.termType === "DefaultGraph" ? "" : ` ${termToString(quad2.graph)}`;
  return `${termToString(quad2.subject)} ${termToString(quad2.predicate)} ${termToString(quad2.object)}${graph} .`;
}
function termToString(term) {
  switch (term.termType) {
    case "NamedNode":
      return `<${term.value.replaceAll(/[>\\]/gu, (character) => `\\${character}`)}>`;
    case "BlankNode":
      return `_:${term.value}`;
    case "Variable":
      return `?${term.value}`;
    case "DefaultGraph":
      return "";
    case "Literal": {
      const quoted = `"${escapeString(term.value)}"`;
      if (term.language) {
        return `${quoted}@${term.direction ? `${term.language}--${term.direction}` : term.language}`;
      }
      if (term.datatype.value === XSD_STRING2) {
        return quoted;
      }
      return `${quoted}^^<${term.datatype.value}>`;
    }
    case "Quad":
      return `<<(${termToString(term.subject)} ${termToString(term.predicate)} ${termToString(term.object)})>>`;
  }
}
function escapeString(value) {
  return value.replaceAll(/[\\"\n\r\t\b\f]/gu, (character) => ESCAPES[character]);
}
var XSD_STRING2, ESCAPES;
var init_serialize = __esm({
  "src/serialize.ts"() {
    "use strict";
    XSD_STRING2 = "http://www.w3.org/2001/XMLSchema#string";
    ESCAPES = {
      "\\": "\\\\",
      '"': '\\"',
      "\n": "\\n",
      "\r": "\\r",
      "	": "\\t",
      "\b": "\\b",
      "\f": "\\f"
    };
  }
});

// src/bin/rdf-parser.ts
import { readFileSync } from "fs";
var require_rdf_parser = __commonJS({
  "src/bin/rdf-parser.ts"() {
    init_index();
    init_serialize();
    function printUsage() {
      process.stderr.write(`Usage: rdf-parser-ts [--format FORMAT] [--base IRI] [--relax] [file]

Parses RDF and writes canonical N-Quads/N-Triples-style lines to stdout.
When no file is passed, input is read from stdin.

Options:
  --format, -f FORMAT  Input format (e.g. text/turtle, application/n-quads)
  --base, -b IRI       Base IRI for relative references
  --relax, -r          Enable relaxed parsing (skips some validation)
  --silent, -s         Suppress output (useful for benchmarking)
  --help, -h           Show this help message
`);
    }
    var args = process.argv.slice(2);
    var format;
    var baseIRI;
    var silent = false;
    var relax = false;
    var file;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--help" || arg === "-h") {
        printUsage();
        process.exit(0);
      }
      if (arg === "--format" || arg === "-f") {
        format = args[++i];
        continue;
      }
      if (arg === "--relax" || arg === "-r") {
        relax = true;
        continue;
      }
      if (arg === "--silent" || arg === "-s") {
        silent = true;
        continue;
      }
      if (arg === "--base" || arg === "-b") {
        baseIRI = args[++i];
        continue;
      }
      if (arg?.startsWith("--format=")) {
        format = arg.slice("--format=".length);
        continue;
      }
      if (arg?.startsWith("--base=")) {
        baseIRI = arg.slice("--base=".length);
        continue;
      }
      if (!file) {
        file = arg;
        continue;
      }
      throw new Error(`Unexpected argument: ${arg}`);
    }
    try {
      const input = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
      const parser = new Parser({ format, baseIRI, relax });
      const quads = parser.parse(input) ?? [];
      let i = 0;
      for (const item of quads) {
        if (!silent) {
          const quad2 = isMessageQuad(item) ? item.quad : item;
          process.stdout.write(`${quadToString(quad2)}
`);
        }
        i++;
      }
      process.stderr.write(`Parsed ${i} quads.
`);
    } catch (error) {
      process.stderr.write(`Error: ${error.message}
`);
      process.exit(1);
    }
  }
});
export default require_rdf_parser();
