/**
 * Type aliases shared between `fetcher.ts` + `fixtures.ts`.
 *
 * Lives in its own file so `fixtures.ts` doesn't import from
 * `fetcher.ts` (which would create a circular import — `fetcher`
 * needs to import the fixture registry).
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
