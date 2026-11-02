# Currency-test ceiling audit

**As of 2026-11-01.** Every advisory ceiling in the repo's currency tests, compared
against the live GitHub advisory API (`GET /advisories?ecosystem=npm&affects=<pkg>`).

Requested by Franco after `betterAuthCurrency` was found green through the entire life
of a CRITICAL better-auth auth bypass.

## Method

The ceiling for a package is the **highest `first_patched_version` across ALL published
advisories for that package**, not the patched version of whichever advisory arrived
most recently. Prereleases are excluded: a caret range cannot resolve to one.

`VULNERABLE_AT_OR_BELOW` must then be the highest published release strictly below that
version — for multer, `< 2.5.0` means the ceiling is `2.4.0`, the last 2.4.x release,
not `2.5.0` and not `2.4.9`.

Reading one advisory and setting the constant from it is what produced two of the three
stale values below. A ceiling that is not derived from the full set is a ceiling that
goes stale the next time an advisory lands.

## Result — the class has seven members

| # | Test | Package | Ceiling | True ceiling | Verdict |
|---|---|---|---|---|---|
| 1 | `backend/.../auth/__tests__/betterAuthCurrency.test.ts` | better-auth | 1.7.6 | 1.7.6 | **FIXED this session** (was 1.6.21) |
| 2 | `frontend/src/services/__tests__/betterAuthCurrency.test.ts` | better-auth | 1.7.6 | 1.7.6 | **FIXED this session** (was 1.6.21) |
| 3 | `backend/.../routes/v1/__tests__/multerCurrency.test.ts` | multer | 2.2.0 | **2.4.0** | **STALE — live HIGH, issue #497** |
| 4 | `backend/.../perimeters/__tests__/admZipCurrency.test.ts` | adm-zip | 0.6.0 | 0.6.0 | current |
| 5 | `backend/src/shared/__tests__/vitestCurrency.test.ts` | vitest | 4.1.10 | 4.1.10 | current |
| 6 | `frontend/src/__tests__/vitestCurrency.test.ts` | vitest | 4.1.10 | 4.1.10 | current |
| 7 | `backend/.../firestarr/__tests__/tzdataCurrency.test.ts` | IANA tzdata | 2026c | 2026c | current **by design** |

Installed vs declared at audit time: better-auth 1.7.7 / `^1.7.7`; multer 2.4.0 /
`^2.4.0`; adm-zip 0.6.1 / `^0.6.1`; vitest 4.1.11 / `^4.1.11`.

## 1 & 2 — better-auth, fixed in 3a90495

Ceiling was 1.6.21, set by GHSA-cq3f-vc6p-68fh and GHSA-2vg6-77g8-24mp. Three newer
advisories all patch at 1.7.7 and had moved the real ceiling to 1.7.6:

- **GHSA-965c-763c-88jm / CVE-2026-114607 (CRITICAL)** — OAuth state token usable as a
  Magic Link to sign in as another user. Range `>= 1.4.0-beta.18, < 1.7.7`.
- **GHSA-r4xp-prcw-77qf (HIGH)** — OAuth Proxy sign-in as another user.
- **GHSA-44jh-23m7-hpcf (LOW)**.

Both files carried the identical stale constant. A prior handoff recorded that the
frontend range was *unasserted* and needed the backend test extended; that was wrong —
the frontend test already existed, asserts both the installed version and the declared
floor, and its docblock explains why it must be separate (it speaks for what EasyMap 3
receives when `@nomad/frontend` is vendored). It was simply stale in the same way.

Proven by four runs: baseline green; each half red when its range is mutated to
`^1.7.5`; and — the one that matters — **green** on that same vulnerable range with the
old 1.6.21 ceiling restored. Only the ceiling value decides whether the guard fires.

## 3 — multer, STALE and a live exposure

Installed 2.4.0, declared `^2.4.0`, and **GHSA-q7qp-rjg7-q26m / CVE-2026-113872 (HIGH)**
covers `>= 2.0.0, < 2.5.0`. The ceiling of 2.2.0 is below the installed version, so the
test passes and reports nothing.

Six advisories patch above the stale ceiling; five are already covered by 2.4.0 and only
CVE-2026-113872 is still live. Full table and remedy in **#497**.

## 7 — tzdata is current by design, not stale

`REQUIRED_TZDATA = '2026c'` looks low — the NWT's own change landed in **2026d** — but
the test's docblock states the reasoning: `America/Edmonton` is the only zone the product
configures (`NOMAD_HOME_TIMEZONE` in `.env.example`) and its change is in 2026c;
`America/Inuvik` needs 2026d and is referenced nowhere, so requiring it would hold the
suite red over a zone Nomad does not serve. **Raise to 2026d only if Inuvik is ever
modelled**, and add the matching offset assertion.

This one is worth naming separately: it is the only member of the class whose low-looking
constant is a decision rather than a decay, and the difference is visible only because
someone wrote down why.

## The general defect

Three of seven ceilings were set once and never revisited. Two had gone stale, one of
them across a CRITICAL. A hand-maintained advisory ceiling is a guard that stops guarding
without emitting anything — the same failure mode these tests exist to catch in
dependencies, occurring in the tests themselves.

Worth considering: derive these constants from the advisory API in CI, so the guard fails
when the ceiling moves instead of when someone happens to look. Raised in #497.
