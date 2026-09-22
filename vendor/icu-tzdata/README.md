# Vendored ICU timezone data

Compiled ICU timezone resources, shipped so the runtime's zone rules do not
depend on whichever Node image happened to be current on build day.

## Why this exists

The Northwest Territories and Alberta stop observing DST: from **2026-11-01
02:00** both are UTC−06 year round (refs #364, #365). Node resolves timezones
through its **bundled ICU**, not through the OS — so `apt-get install tzdata`
changes nothing, and neither does a correct host.

Measured 2026-09-21, by reading `process.versions.tz` in each image:

| Image | Node | ICU | tzdata |
|---|---|---|---|
| `node:22-slim` | 22.23.2 | 78.2 | **2026a** |
| `node:22-alpine` | 22.23.2 | 78.2 | **2026a** |
| `node:24-slim` | 24.21.0 | 78.3 | **2026c** |

**No published Node image carries 2026d.** Current `node:22-*` is on 2026a,
which predates even the Alberta change. There is nothing to pin to, so the
data is carried here instead and ICU is pointed at it.

## What is here

`2026c/` — four files from the `unicode-org/icu-data` repository, path
`tzdata/icunew/2026c/44/le/`:

```
zoneinfo64.res     the zone rules themselves
metaZones.res      zone -> metazone mapping
timezoneTypes.res  canonical ids and aliases
windowsZones.res   Windows zone id mapping
```

About 236 KB in total. `44` is the ICU data format version; `le` is
little-endian.

## Why 2026c and not 2026d

IANA released **2026d** on 2026-09-11, and it is the release that carries the
NWT change for `America/Inuvik`. Unicode had **not** published compiled ICU
data for it at the time of writing — `tzdata/icunew/2026d/` returns 404.

2026c carries the **Alberta** change, which covers `America/Edmonton` — the
only zone Nomad is configured for (`NOMAD_HOME_TIMEZONE`), and the zone most
of the NWT uses. So 2026c closes this product's actual exposure.

`America/Inuvik` still requires 2026d. Nomad does not reference that zone
anywhere; if it ever does, this needs updating and so does `REQUIRED_TZDATA`
in `backend/src/infrastructure/firestarr/__tests__/tzdataCurrency.test.ts`.

## How it is used

Both the container and the test runner point ICU at this directory:

- `backend/Dockerfile` — copies it in and sets `ICU_TIMEZONE_FILES_DIR`
- `backend/vitest.config.ts` — sets the same variable, so the tests exercise
  the data actually shipped rather than the developer machine's ICU

`process.versions.tz` reports the override, so the runtime can state which
timezone database it is really using. `tzdataCurrency.test.ts` asserts it.

## Updating to a newer release

1. Check whether the release exists as compiled ICU data:
   `https://raw.githubusercontent.com/unicode-org/icu-data/main/tzdata/icunew/<release>/44/le/zoneinfo64.res`
2. Download all four files into `vendor/icu-tzdata/<release>/`
3. Point `ICU_TIMEZONE_FILES_DIR` at the new directory in both places above
4. Raise `REQUIRED_TZDATA` in `tzdataCurrency.test.ts` and run the suite —
   those tests fail until the runtime genuinely reports the new release

Keep the old directory until the new one is verified. Reverting is then a
one-line change rather than a re-download.
