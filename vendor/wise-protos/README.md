# WISE fgmj protobuf schema

`fgmj_descriptor_set.pb` — a compiled protobuf `FileDescriptorSet` describing the
`.fgmj` (Fire Growth Model Job) format. Vendored for the Prometheus/WISE import
feature (#294).

## Why this is here rather than a hand-written parser

The `.fgmj` file is a **protobuf JSON serialization**, not ad-hoc JSON. WISE's own
validation output names the messages: `CWFGM.PSaaS`, `CWFGM.ProjectProto.Project`,
`CWFGM.FireEngineProto.CwfgmScenario`, `CWFGM.GridProto.TemporalCondition`.

Loading this descriptor set at runtime (protobufjs) gives, without a codegen step:

- **Exhaustive fields**, including ones no sample file happens to use.
- **Both proto3 JSON name forms.** The spec permits emitters to write either the
  original snake_case field name or its lowerCamelCase form, and real files do
  both — `timezone_id` in a Prometheus export, `timezoneId` in WISE jobs. The
  runtime handles this; a hand-written field list silently misses one form.
- **Correct enum decoding per message.** `weatherGridFilter.proto` declares TWO
  enums both named `Operation` with different numbering:

      GridTypeOne.Operation  { Equal=0, Plus=1, Minus=2, Multiply=3, Divide=4, Disable=5 }
      GridTypeTwo.Operation  { Equal=0, Plus=1, Minus=2, Disable=3 }

  `Disable` is 5 in one and 3 in the other. Sharing one enum across both would
  read `Disable` as `Multiply` on wind-direction patches, silently.
- **`oneof` handling** — `GridTypeTwo` (`value` | compass `direction`) and
  `DailyConditions.weather` (`dayWeather` | `hourWeather`).
- **Hard failure on unknown shapes** rather than silent `undefined`, which is the
  fail-fast behaviour #294 requires.

## Why not the TypeScript API

`WISE_JS_API` is a **write-only builder**. Verified against upstream `main`
(`WISE-Developers/WISE_JS_API`, `src/wiseInterface.ts`, 9,588 lines,
`1.0.0-beta.0`):

- no `fromJSON`, `deserialize` or `static from*` of any kind — it cannot read an fgmj
- `WeatherPatchOperation` declares five values and **omits `Disable`**; the string
  "Disable" does not appear anywhere in the file

So the TS API is not merely less convenient — it is an incomplete description of
the format, and a parser derived from it would be wrong in a way that source
cannot reveal.

## Provenance

Supplied by Franco Nogarin on 2026-09-30, collected from the public WISE source
repository (the `.proto` files are spread across it) into one archive. The
descriptor set is the compiled form of 42 `.proto` files including
`cwfgmProject.proto`, `projectScenario.proto`, `cwfgmFilter.proto`,
`weatherGridFilter.proto`, `projectIgnition.proto` and `dailyConditions.proto`.

    sha256  14f99076981966ebf546b639...   (89 KB)

## Regenerating

From a checkout of the WISE source, with the `.proto` files gathered:

    protoc --include_imports --descriptor_set_out=fgmj_descriptor_set.pb <proto files>

`--include_imports` matters: without it the set is incomplete and references to
`math.proto`, `wtime.proto` and `google/protobuf/wrappers.proto` fail to resolve.

## One schema fact worth reading before touching units

`cwfgmFilter.proto`, `DailyAttribute`:

    Math.Double minRh = 5;   // stored as a decimal, between 0 and 1

Prometheus writes `minRh: 95`, which is **out of that declared range**. So
"percent or fraction?" is answerable as a schema-validity question rather than a
heuristic. Weather *patch* values (`rh: 0.05`) are fractions in both producers,
consistent with `setValuePercent` storing `value / 100.0` — and FireSTARR's
weather CSV uses percent, so patch RH converts ×100.
