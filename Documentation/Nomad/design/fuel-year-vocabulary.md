# Fuel years: dataset year vs fuel vintage

**Status:** decided, issue #431
**Applies to:** anything that reads, stores, displays or reports a fuel year

Two different years are involved in every fire model run. NOMAD conflated them for
months, displaying one under the label of the other. This document fixes the vocabulary
so that cannot silently return.

## The two years

| Term | Meaning | Where it comes from |
|---|---|---|
| **model year** | the year being modelled — the year of the fire | the run's start date |
| **dataset year** | the year a fuel dataset is installed and keyed under | directory name, `dataset.json`, the dataset index |
| **fuel vintage** | the season the fuel data actually describes | derived: `datasetYear - 1` |

```
fuel vintage = dataset year - 1
```

## Why the fuel vintage is a year behind

Disturbance mapping lags the season it describes. A fuel layer for the start of the 2026
season is built from data through the end of 2025 — fire perimeters, harvest, regrowth and
reclassification observed in 2025 and earlier. **There are no 2026 fuels until the 2026
season has happened.**

The dataset index says this itself, and has always said it:

```json
{"vintage": 2026, "label": "start-of-2026 fuels; input for 2026 model runs"}
```

"Start-of-2026 fuels" is the 2025 vintage. The field is named `vintage` and holds the
dataset year, which is the whole origin of the confusion.

## Where the rule lives

**One place:** `backend/src/domain/value-objects/fuelYears.ts`

```ts
fuelVintageForDatasetYear(datasetYear: number | undefined): number | undefined
```

It is in the **domain** because it is a fact about fire data, not about a screen or an
endpoint. Dependencies point inward: the catalog, the recorded-run service, the API and
the frontend all consume it; none re-implements it.

**The frontend does not compute it.** `frontend/src/shared/utils/fuelYears.ts` reads
`fuelVintage` off the payload and will report `undefined` rather than reconstruct it from
the dataset year, even though the arithmetic is one subtraction. There is a test asserting
exactly that. The reason is that Pack-and-Go reporting (#426) and openNomad consumers are
served by the same backend — a second implementation is how two numbers drift apart, and
a drifted year is the error no downstream reader can catch.

## Naming rules

**In TypeScript, in the API payload, and in any new code:**

- `datasetYear` — never `vintage` — for the year a dataset is keyed under
- `fuelVintage` — for the season the fuel describes
- `modelYear` / `requestedYear` — for the year being modelled

**Never use the bare word `vintage` for a new field.** It is the word that failed.

**On disk, `vintage` stays**, in three places, each deliberately:

| Where | Why it is not renamed |
|---|---|
| `dataset.json` in each dataset directory | a real file format, written by the installer and read by installed systems |
| the dataset index (`index.json`) | changing it is a compatibility decision about already-installed hosts, not a cleanup |
| the per-run `fuel-vintage.json` record | it is evidence of what a completed run used; rewriting it is the failure #331 closed |

These hold the **dataset year** despite the name. Code reading them must convert at the
boundary and not propagate the word inward.

## Display rules

Show **both** years, each labelled. Showing one and calling it the other is what produced
the defect:

```
Model year:   2026
Fuel vintage: 2025 (start-of-2026 fuel state)
```

The parenthetical is not decoration. The dataset directories are named for the model year,
so to anyone who knows the layout, a bare "2025" reads as a bug. Naming the dataset the
vintage came from makes the relationship visible rather than asking the reader to remember
a convention.

**Never infer a vintage.** Where no dataset year was recorded — the `default` directory
carries no year — display "not recorded". An inferred vintage looks identical to a real
one, which makes it unfalsifiable by the person reading it (#331).

**Reports must state the fuel vintage, not only the model year** (#426). A report outlives
everyone's memory of the convention, and it leaves the building.

## What went wrong, so it is not repeated

Two source comments asserted the opposite of the truth:

> `Convention: vintage = RUN year (start-of-year fuel state). A run in year N uses dataset N. It is not off-by-one.`

They appeared in `IFuelDatasetCatalog.ts` and `fuelDatasets.ts`. They were an attempt to
document exactly this, pointed the wrong way — and because they pre-emptively denied the
off-by-one, they are the reason the defect survived review. A confident comment is not
evidence.

The lesson worth keeping: the sentence was defensible for what it described (dataset
resolution *is* keyed on the run year) and still produced a wrong number on screen,
because it used one word for two quantities. Vocabulary is not cosmetic when two
quantities differ by one and both are plausible.

## Where this is enforced

- `backend/src/domain/value-objects/__tests__/fuelYears.test.ts` — the rule
- `backend/src/application/services/__tests__/fuelVintageRecord.fuelVintage.test.ts` — the recorded path
- `frontend/src/shared/utils/__tests__/fuelYears.test.ts` — the reader, including the no-reconstruction guard
- `frontend/src/shared/components/__tests__/FuelVintageNotice.bothYears.test.tsx` — both values displayed, separately labelled
