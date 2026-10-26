/**
 * The shapes the library's modules hand each other and the projects (Sami, 26/10/2026: the types checked from the
 * JSDoc, `npm run types`, as in the projects). Nothing runs here: a module names a shape with
 * `@typedef {import("./types.js").Job} Job`.
 *
 * @typedef {any} World  a scenario the search plays: the project's own, drawn by `Problem.sample`
 * @typedef {any} Move   a decision of a world: the project's own, named by `Problem.key`
 *
 * @typedef {object} Job  a job of the machine's queue (bin/backlog.js, docs/backlog.md)
 * @property {string} id
 * @property {string} cwd        the folder it runs in
 * @property {string} command
 * @property {string} [estimate] "40 min", "1 h 30"
 * @property {"todo" | "scheduled" | "running" | "done" | "failed" | "timeout" | "skipped" | "cancelled"} status
 * @property {number} [threads]
 * @property {1 | 2 | 3} [priority]
 * @property {string[]} [after]  ids that must be finished first
 * @property {string} [due]      when its result should be there (local ISO)
 * @property {string} [notBefore]
 * @property {number} [limit]    minutes at most
 * @property {string} [skipIf]   a command of its project: exit 0 skips it
 */
export {};
