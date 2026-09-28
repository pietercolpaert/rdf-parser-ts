/**
 * Stand-in for readable-stream in the browser bundle: the browser entry has its own Web Streams based
 * StreamParser, so the Node.js-style one only needs a base class to extend.
 */
// eslint-disable-next-line ts/no-extraneous-class
export class Transform {}
