/**
 * Test stub for the `server-only` package.
 *
 * The real package throws on import unless the bundler marks the module as a
 * React Server Component. Vitest runs the server modules directly (there is no
 * server/client boundary to enforce), so tests alias it to this no-op.
 * The production guard is still real: `server-only` is left untouched in the
 * Next.js build, where importing it from a client bundle fails the build.
 */
export {};
