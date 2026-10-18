// Parity fixture generator for Phase 1 (engine/math).
//
// Imports the real three.js math modules straight from the pinned `three` package's src/math
// (never build/) and writes deterministic JSON fixtures to parity/math/<Type>.json.
// Expected values are always computed by three.js; nothing here is hand-written.
//
// Run from anywhere:  node parity/math/gen/generate.mjs
//
// Fixture format (see parity/math/README.md):
//   { "meta": {...}, "cases": [ { "op": "Vector3.applyMatrix4", "in": [...], "out": [...] }, ... ] }
// "in" and "out" are flat number arrays. Non-finite numbers are the strings
// "Infinity", "-Infinity", "NaN". Float inputs are rounded to f32 (Math.fround) BEFORE
// three.js sees them, so the reference and the f32 engine start from identical inputs.

// The generator is split into `parts/`; running it writes every fixture.
import './parts/run.js';
