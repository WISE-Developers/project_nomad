# @nomad/frontend

The Project Nomad web client, and the library published as
`nomad-frontend-<version>.tgz` for host applications to embed (see
`src/openNomad/`). The root [README](../README.md) covers the project as a
whole; this file documents what a CONSUMER of the library needs to know.

## React is a peer dependency

`@nomad/frontend` is a library. `vite.lib.config.ts` externalises `react`,
`react-dom` and `react/jsx-runtime`, so **the consuming application provides
them** — they are declared in `peerDependencies`, not `dependencies`:

```json
"peerDependencies": {
  "react": "^18.3.1 || ^19.0.0",
  "react-dom": "^18.3.1 || ^19.0.0"
}
```

Declaring them as `dependencies` instead ships a second React into every
consumer's tree. A consumer on a different React major then gets npm nesting a
private copy, two Reacts loading, and `Invalid hook call` from any component
using a hook. That is what blocked EasyMap 3's React 18 → 19 upgrade, and it was
found as a runtime error in a browser rather than by any check.

`scripts/__tests__/react_is_a_peer_dep.test.sh` guards this in CI.

**Testing against another React major** requires the declaration to agree at the
**workspace root AND this package** — setting it only here leaves npm hoisting a
peer-satisfying copy to the root and nesting the new one, after which
`@testing-library/react` binds the wrong copy and every result is meaningless.
The `Frontend on React 19` CI job shows the shape, and asserts what the harness
resolves before trusting anything it reports.
