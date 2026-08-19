// Deliberately plain JS with no decorators — Vercel's zero-config /api
// builder does not reliably support TypeScript's emitDecoratorMetadata
// (a well-documented gap for decorator-heavy frameworks like Nest), so this
// file stays untouched by that concern and just hands off to the already
// fully-compiled output of our own `nest build` (which uses tsc directly
// and handles decorator metadata correctly).
module.exports = require('../dist/serverless').default;
