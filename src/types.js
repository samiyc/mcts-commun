/**
 * The shapes the library's modules hand each other and the projects (Sami, 26/10/2026: the types checked from the
 * JSDoc, `npm run types`, as in the projects). Nothing runs here: a module names a shape with
 * `@typedef {import("./types.js").World} World`. A job's shape is the queue's (docs/backlog.md, « Un job ») and was
 * typed here unused: dropped on 31/10/2026.
 *
 * @typedef {any} World  a scenario the search plays: the project's own, drawn by `Problem.sample`
 * @typedef {any} Move   a decision of a world: the project's own, named by `Problem.key`
 */
export {};
