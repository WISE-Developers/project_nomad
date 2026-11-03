# Upgrading Nomad

Notes for operators upgrading an existing Nomad deployment. Newest first.

Read the entry for every version between your current one and the target — a
required key added in one release still applies if you skip past it.

---

## BREAKING for `@nomad/frontend` consumers: three map packages are now peer dependencies (#485)

**If you embed `@nomad/frontend`, you must declare these yourself. Every consumer,
not only the ones that render a map.**

```
maplibre-gl                      ^6.10.0
terra-draw                       ^1.26.0
terra-draw-maplibre-gl-adapter   ^1.4.1
```

They moved from `dependencies` to `peerDependencies`, **required, not optional.**
Add them to your own `package.json` on upgrade.

### Why not optional, which is what this note said first

An earlier version of this entry said the three were optional peers and that a
consumer embedding only the Dashboard was unaffected. **Both halves were wrong,
and the correction came from a downstream consumer measuring it rather than from
us.** Two measurements settle it:

1. **The built library imports all three unconditionally.** `openNomad.umd.cjs`
   carries `require("maplibre-gl")`, `require("terra-draw")` and
   `require("terra-draw-maplibre-gl-adapter")` at top level, and the ES entry
   statically imports the single chunk that holds them. There is no dynamic
   import, so no surface avoids them -- mounting only the Dashboard still loads
   the module that imports maplibre.
2. **npm treats the two declarations differently.** Installed from a tarball,
   which is how a vendoring consumer actually consumes this package: a
   **required** peer is installed, an **optional** peer is not.

Together those mean `optional` would have guaranteed an unresolved module for
anyone who simply ran `npm install` -- and nothing would have caught it. The
install succeeds, no typecheck looks inside a vendored `dist`, and the test
suite passes. It would have failed at runtime, during a deploy.

### What was wrong

`vite.lib.config.ts` externalised seven entries under the comment *"Externalize
peer dependencies - consumers must provide these"* — but only `react` and
`react-dom` were declared as peers. An externalised module is **not in the
bundle**, so your resolver has to find it, and `dependencies` is the wrong field
for that contract: resolution rested on hoisting, which strict layouts (pnpm's
default, Yarn PnP) do not guarantee. `maplibre-gl` also carries module-level
state, so a consumer on a different major could load two copies — the failure
`peerDependencies` exists to prevent, and the hardest to read back from the
symptom.

### What you gain for the one-time cost

**You can now upgrade these yourself.** Carried transitively, a CVE in
`maplibre-gl` was clearable only by waiting for a Nomad release and
re-vendoring the tarball — which has already cost a downstream consumer a
forced re-vendor. As a declared peer you bump it on your own schedule.

Note this does **not** add a package to your tree that was not already there:
`@nomad/frontend` installed `maplibre-gl` transitively on every prior line. The
change moves *who controls the version*, not whether it is present.

### `@turf/turf` went the other way

It is no longer externalised at all — it is bundled. It is stateless functions,
so a duplicate copy is harmless, and bundling removes the contract rather than
documenting it. **Measured cost: +6,071 bytes on `openNomad.umd.cjs`, +0.5%** —
tree-shaking means only the functions NOMAD imports land in the bundle, not all
of turf. Nothing for you to declare.

Pinned by `frontend/src/__tests__/libExternalsPeerContract.convention.test.ts`,
which reddens if an entry is externalised without a peer declaration, or if a
`globals` entry survives for a package that is no longer external.

---

## If you build from a 0.19 tag, move to `v0.19.0-react19.2` (#487)

**Only affects builds made FROM a 0.19 git tag.** Installing a published
`@nomad/frontend` tarball is not affected — npm excludes the lockfile from a
published package, so the pin below has no path into a consumer's tree.

Ten 0.19 tags pin `better-auth` at **1.7.5**, which sits inside the vulnerable
range of a critical advisory on its OAuth path:

- **GHSA-965c-763c-88jm / CVE-2026-114607**, critical — OAuth state usable as a
  magic link to sign in as another user. Vulnerable `>= 1.4.0-beta.18, < 1.7.7`.
- **GHSA-r4xp-prcw-77qf**, high — OAuth Proxy lets an attacker sign in as
  another user.

Measured across every 0.19 tag rather than inferred from the release order:

```
v0.19.0, v0.19.0-react19.1, v0.19.1 .. v0.19.8   better-auth 1.7.5   affected
v0.19.0-react19.2                                better-auth 1.7.14  fixed
```

**Released tags are not re-cut**, so these ten stay as they are — retagging
would invalidate anything already citing them. `v0.19.0-react19.2` is the 0.19
release carrying the fix; `backport/react19-0.19.0` is also at 1.7.14, so a
build from the branch tip is fine.

### Whether it reaches you

`better-auth` implements only the `oauth` authentication mode, mounted
exclusively when `NOMAD_AUTH_MODE=oauth` and the deployment mode is not `ACN`.
The `none` (default) and `simple` modes never load it, so the vulnerable path
requires `oauth` with social providers configured. That narrows the exposure —
it does not remove it, and no deployment was audited for its actual mode.

### To check your own build

```bash
npm ls better-auth
```

Anything below 1.7.7 is inside the range.

---

## Rollback image tags now name the version they CONTAIN (#437)

**Nothing to do. This changes what a tag means, and tags made before this
release mean the other thing.**

`scripts/deploy.sh` tags the image it is replacing so a rollback is one
command. It used to name that tag after the version being deployed **to**, so
the image inside was always one release older than the name:

```
rollback-0.28.0  ->  contained 0.26.0
rollback-0.26.0  ->  contained 0.25.0
rollback-0.25.0  ->  contained 0.24.0
```

Measured on the CIFFC demo across three generations, not inferred.

**From this release, a rollback tag names the version inside it.**
`rollback-0.28.0` contains 0.28.0. The version is read out of the outgoing
image's own `/app/VERSION` rather than from the repository being deployed.

### Why it mattered

The rollback path itself always worked — this was a naming fault, not a
functional one. But the tag is read during an outage, by whoever is on hand,
and the old name supported two readings that disagreed:

- *"`rollback-0.28.0` is what I roll back **to** when 0.28.0 goes bad"* — what
  the script meant, and it worked.
- *"`rollback-0.28.0` **is** 0.28.0"* — what the name said, and it was false.

Anyone checking "am I running the version this tag names?" got a wrong answer,
and the only way to see the discrepancy was to run the image and read the file.

### Your existing tags are NOT renamed

Retagging would invalidate any runbook or note that already cites them, so old
tags are left exactly as they are. **Treat any `rollback-*` tag created before
this release as containing the version below its name**, and anything created
after as containing the version it names. To settle it for a specific image
rather than relying on the rule, ask the image:

```bash
docker run --rm --entrypoint cat <image>:<tag> /app/VERSION
```

### If the version cannot be read

An image older than `/app/VERSION`, or a docker failure, leaves the deploy
unable to name the outgoing version. It does **not** guess, and it does not
silently skip the tag — both of those were considered and rejected. It warns,
and tags as `rollback-unknown-<short image id>` so the rollback target still
exists under a name that cannot be mistaken for a version.

---

## Upgrading to the release containing the usage log (#332)

### BREAKING: `NOMAD_HOME_TIMEZONE` is required

**Symptom if you skip this step:** the backend refuses to start and logs

```
Failed to start server: Error: Required environment variable "NOMAD_HOME_TIMEZONE" is not set.
```

The process exits with status 1. Nothing is corrupted and no database work is
performed — the check runs before any side effect — but the service will not
come up until the key is present.

### What to do

Add one line to your `.env`:

```
NOMAD_HOME_TIMEZONE=America/Edmonton
```

Use the IANA zone name for wherever the deployment actually lives:

| Location | Value |
|---|---|
| Yellowknife, Edmonton, Calgary | `America/Edmonton` |
| Winnipeg, Regina‡ | `America/Winnipeg` |
| Toronto, Ottawa | `America/Toronto` |
| Vancouver, Victoria | `America/Vancouver` |
| Halifax | `America/Halifax` |

‡ Saskatchewan does not observe DST — use `America/Regina` for a deployment there.

Then restart as usual for your install type.

### Rules

- **It must be a zone NAME, not an offset.** `-06:00` is rejected: a fixed offset
  cannot observe DST, so it would freeze the deployment on the summer offset all
  winter.
- **A typo fails loudly.** `America/Yellowknive` produces
  `Invalid NOMAD_HOME_TIMEZONE: "America/Yellowknive" is not a valid IANA time zone name.`
  and the backend exits rather than starting with a wrong clock.
- **There is deliberately no default.** The container's own clock is UTC, so
  falling back would stamp every local timestamp six hours wrong while every
  health check stayed green. Crashing is the intended behaviour.

### Why the key exists

Usage log entries carry two timestamps: `ts_utc` for machines (sorting,
durations, comparing deployments) and `ts_local` for people — wall-clock time
where the box actually sits, so nobody on shift has to do arithmetic. This key
is the zone used for `ts_local`.

### BREAKING: `NOMAD_USAGE_LOG_PATH` and `NOMAD_USAGE_LOG_MAX_BYTES` are required

Same shape as the time zone above — the backend exits 1 if either is missing.

Add to your `.env`:

```
NOMAD_USAGE_LOG_PATH=/appl/data/usage/usage.jsonl
NOMAD_USAGE_LOG_MAX_BYTES=52428800
```

**The path MUST be on a mounted volume.** In the Docker deployment `/appl/data`
is the mounted dataset path. A path outside a mount — `/data`, for instance —
lives on the container's overlay filesystem and is **destroyed every time the
container is recreated**, which includes every upgrade. The writes succeed, so
nothing warns you; the log simply disappears exactly when you would want to
compare before and after.

On a bare-metal install there is no container, so use a real host path beside
your dataset, e.g. `/home/you/firestarr_data/usage/usage.jsonl`.

`NOMAD_USAGE_LOG_MAX_BYTES` bounds the file; `52428800` is 50 MB. It is required
rather than defaulted because a field laptop cannot host an unbounded log, and
the right size is a deployment decision.

### Optional: the usage query endpoint

`GET /api/v1/usage` is **off by default and not registered at all** unless a
token is configured. There is no way to reach it by accident.

To turn it on, add to `.env`:

```
NOMAD_USAGE_API_TOKEN=<at least 32 characters>
```

Generate one with `openssl rand -hex 32`. A shorter value is rejected at
startup, and there is no default — a default token is a published password.

Call it with:

```
curl -H "Authorization: Bearer $NOMAD_USAGE_API_TOKEN" \
     "http://localhost:4901/api/v1/usage?limit=100&type=model.run.failed"
```

Notes:

- Responses are always bounded (default 100, maximum 1000) and report
  `truncated: true` rather than implying completeness.
- **Every read is itself logged**, including rejected ones. The presented token
  is never written to the log.
- The log holds identities, timestamps and activity patterns. Treat the token
  like any other credential, and note that enabling the endpoint makes a
  personnel-shaped record reachable over the network.

### Fresh installs

No action needed. All installers write the key:

- `install-nomad-san-metal.sh`, `install_nomad_setup.sh` and
  `install-nomad-san-metal.ps1` prompt for it, pre-filled from
  `NOMAD_HOME_TIMEZONE` if set, defaulting to `America/Edmonton`.
- `install-nomad-san-docker.sh`, `install-nomad-san-docker.ps1`,
  `install-nomad-demo.sh` and `install-nomad-headless.sh` are non-interactive
  and take the value from the environment, defaulting to `America/Edmonton`.

All of them validate the value before writing it, so a typo fails during install
rather than at first boot.
