# FireGUARD output design input for NOMAD

Source: McFayden, C.B., D. Boychuk, J. Evens, D. McLarty, A. Stacey, D. Leonard and J. Shields. 2025. "History and overview of research and development for Ontario's FireGUARD decision support system for appropriate response." *The Forestry Chronicle* 101(2): 131–145.

Context: Colin McFayden (lead author) gave Project Nomad design feedback pointing at this paper as an example of "the kinds of data we were pulling from simulations... charts, plots, etc." This note treats the paper as a specification of the outputs he is asking for, extracted with page/figure locators for every claim.

FireGUARD = Fire Growth under Uncertainty for Appropriate Response Decision Support, Ontario's prototype real-time wildfire DSS (R&D 2015–2020, piloted 2018–2019). FireSTARR (Fire Space Time Alternating Rapid Reduction) is its fire growth engine and is also the engine NOMAD is a GUI for.

---

## 1. Catalogue of simulation-derived figures, charts, maps and tables

| # | Location | What it shows | Axes / units | Aggregation | Operational question answered |
|---|----------|----------------|--------------|-------------|-------------------------------|
| Fig. 4 | p.138 | System diagram: component models (WeatherSHIELD, FireSTARR, RamPART, CostARMS) and data flow to "burn probability and intensity by grid cell," "risk by grid cell," "total impact by grid cell," "suppression cost / monitored cost" | n/a (flowchart) | per grid cell (dynamic datasets) | How do model outputs compose into the PDF report? |
| Fig. 5 | p.139 | "Simulation statistics for FOR 66 from 2021... simulation was started from the 10-ha report size." Table: Day, Date, Min/Average/Median/Max size (ha), Total Risk (Avg Loss), for days 1, 2, 3, 7, 14 | ha (size); unitless risk score | per-fire, per forecast day, summarized across all simulations run for that fire | Fire-size distribution summary and risk trend across the 14-day horizon |
| Fig. 6 | p.139 | "An example of burn probability symbology, day 14 on FOR 66, 2021." Choropleth map, divergent palette: blue <10%, yellow→red for ≥10%, bins at 10% intervals from 10–20% up to 90+% | % probability per 1-ha cell | per-cell, per forecast day (1,2,3,7,14) | Spatial burn-probability map for situational awareness / reconnaissance planning |
| Fig. 7 | p.140 | "A histogram of simulated fire sizes at the end of day 14 for FOR 66 in 2021." Bars: 1, >1–10, >10–100, >100–1k, >1k–10k, >10k–100k, >100k ha, with % of simulations in each class (0.0%, 13.4%, 28.9%, 54.2%, 3.6%, 0.0%, 0.0% in the example) | % of simulations (y), fire-size class in ha (x) | per-fire, single forecast day (day 14 only in this example) — "This provides more information than the size statistics table on Fig. 5, and it is more quickly understood" | Resource-requirement estimation (crew/equipment sizing) from size-class likelihood |
| Fig. 8 | p.140 | "Selected example charts... from the weather forecast overview page." Four panels: 24-hr precipitation, to-date (cumulative) precipitation, wind rose by day (days 1,2,3,14), Initial Spread Index overlaid on FWI danger-class colour bands | mm (precip), ISI value, wind speed/direction | ensemble: median, 66th percentile, 90th percentile, plus AFFES official forecast, climate min/max, climate median, and "probability of no precipitation" | Weather/fire-weather uncertainty context behind the fire-growth simulations |
| Fig. 9 | p.141 | "The potential maximum impact if the area burned with a high intensity for FOR 66 in 2021." Map, divergent palette, categories "Extreme" to "Low" | categorical impact score per cell | per-cell, worst-case (not probability-weighted) | Worst-case scoping: "what could be lost if everything burned at high intensity" |
| Fig. 10 | p.141 | "A map of risk for FOR 66 in 2021 on day 14. The total risk score is 7." | categorical risk score per cell ("Extreme" to "Low"); scalar "Total Risk" summary | per-cell map + single scalar = sum of all cell risk values within the burn-probability extent, per forecast day | Likelihood-weighted impact map; single-number triage metric comparable across fires and across days for the same fire |
| Fig. 11 | p.142 | "Interpretation aid for understanding the total impact and risk scores." Table: scenario (1 structure; 100 ha timber; 1 km hydro line; example sum) → Total Potential Impact (HFI 4000+ kW/m) and Risk at 50%/90% probability | impact score (0–10 scale implied by Table 2's 1–10 scaling) | per resource/asset-type scenario, not per-fire | Translates an abstract risk number into a plain-language equivalent ("a risk of 10 is like the loss of 200 ha of timber, or worse than the loss of a structure") |
| Fig. 12 | p.142 | "Example of anecdotal forecast validation: the actual observed temperature overlaid on the original forecast." Time series, Aug 1–30, with Mean, 66%, 90%, Min/Max bands, Climate Min/Max, Climate Mean, observed, AFFES forecast | °C vs. date | ensemble forecast bands vs. single observed trace | Lets users judge whether a given forecast (and by extension the fire simulations built on it) was reliable after the fact |
| Fig. 13 | p.143 | FireSTARR national webservice visualized in "Firehawk" (CFS platform), showing burn-probability layers (0.0–0.9+, "not simulated," "unprocessed," "processing," "beating") at landscape scale with multiple concurrent fires, forecast day selector (2025-06-22, Day 14) | % burn probability per cell, multi-fire | per-cell, multiple fires simultaneously, selectable forecast day | Demonstrates the FireSTARR-only (no impact/risk) landscape-scale successor product |

Figures 1, 2, 3 (pp.132, 134, 135) are process/conceptual diagrams (fire-zone history, DSS usefulness-by-expertise matrix, scoping-methodology steps) — **not** simulation-derived data and excluded from the count above.

**Simulation-data figure count: 9** (Figs. 4–13 minus Figs. 1–3; i.e., Figs. 4, 5, 6, 7, 8, 9, 10, 11 [derived/interpretive], 12, 13 — note Fig. 11 is an interpretation table rather than a plotted figure but is included as it presents simulation-derived score meanings).

---

## 2. Fire-size and ensemble outputs (the main ask)

Two, and only two, forms appear in the paper:

1. **Tabular summary statistics across simulations, per forecast day** (Fig. 5, p.139): for each of days 1, 2, 3, 7, 14, the table reports **Min, Average, Median, and Max** fire size in hectares, plus a scalar **Total Risk (Avg Loss)** for that day. The caption explicitly defines median as "half of the fires are smaller and larger than the median size." This is the closest the paper comes to a fire-size-over-time product, and it is a static table, not a plotted band/fan chart.
2. **A single-day histogram of fire-size classes** (Fig. 7, p.140), built from the same simulation ensemble, for day 14 only in the example shown. Classes are log-scale ha bins (1; >1–10; >10–100; >100–1k; >1k–10k; >10k–100k; >100k), reported as **percent of simulations falling in each class**. The text states its purpose directly: "if most simulated fires are 10–100 ha, this helps estimate crew and equipment requirements."

**Gaps relative to Colin's stated ask** (explicit, not inferred):
- The paper does **not** show a continuous fire-size-over-time chart with percentile bands/fan — only discrete-day snapshots (Fig. 5 table) and a single-day histogram (Fig. 7).
- The paper does **not** present an explicit **exceedance-over-threshold** product (e.g., "probability final size exceeds X ha"). The size-class histogram bins are the nearest analogue, but they are not framed or computed as exceedance curves.
- The paper does **not** show the Fig. 7-style histogram repeated across multiple forecast days for the same fire — the example given is day 14 only, so whether FireGUARD routinely produced per-day histograms (vs. just day 14) is **not stated**.
- No per-fire distribution of "time to a given size" or "time to containment-relevant threshold" is shown.

---

## 3. Risk = likelihood-weighted impact (NOT burn probability × impact)

Table 2 (p.137) is the paper's explicit definition, worth quoting in full structure: columns are **"What can happen?" → "What are the consequences?" → "How likely will it happen?" → "What is the risk?"**, mapped to **Fire effects → Fire impacts → Probability → Risk**. Verbatim: *"Probability [is] the likelihood of the fire effects and impacts... estimated separately or together... Risk is always less than the full potential impact because of the reduced likelihood that the event will occur."* And: *"Risk... [is] Probability weighted impact."*

Text (p.136) states the combination rule directly: *"Our model for combining likelihood and impact into risk uses probability-based reasoning, where likelihood downscales impact. This likelihood-weighted impact is the average loss one would expect if the same scenario were repeated many times."* It explicitly rejects multiplying ordinal 1–5 scales (the "25 has no inherent meaning" critique, p.136) in favour of an arithmetic, units-interpretable approach.

- **Burn probability** comes from FireSTARR: "Burn probability is based on the number of times something burns in a simulation. The number of simulations is based on the possible weather and fire behaviour scenarios" (Table 2, p.137).
- **Impact** comes from **RamPART** (Resources and Assets Impact Relative Total): *"indicates where fire-sensitive resources and assets exist on the landscape. It shows the relative negative social, economic, and emergency response impacts and their weighted combination resulting from fire exposure. Expert knowledge elicitation was used to quantify impacts"* (p.137). Impact is scored per 1-ha cell from Land Information Warehouse Ontario data, calculated "under high fire intensities" (p.137), with impact categories = **Social, Economic, Emergency response** (Table 2, p.136).
- **Risk per cell** = likelihood-weighted impact, mapped in Fig. 10 (p.141).
- **Total Risk score** = *"the sum of risk values across all cells within the burn probability extent"* (p.140), used for two purposes stated explicitly: (1) temporal comparison — tracking how risk changes day to day for one fire, and (2) triage across fires — comparing total-risk scalars between different fires to prioritize response (worked numeric example given: Fire A risk 100 vs. Fire B risk 10,000 → "Fire B poses several orders of magnitude higher relative risk," p.140).
- **Maximum impact map** (Fig. 9, p.141) is impact alone, not risk: *"the impact if the entire area within the extent of the map were to burn at high intensity"* — used to anchor/calibrate the subsequent probability-weighted risk interpretation, not a decision product by itself.
- **Interpretation aid** (Fig. 11, p.142) ties the abstract score to intuitive equivalents, e.g. *"A risk of 10 is like the loss of 200 ha of timber, or worse than the loss of a structure."*

---

## 4. Smouldering and natural extinction

**FireSTARR's description explicitly includes these processes** (p.137): *"This model spatially models wildfire growth, smouldering, reactivation, and self-extinguishing. These are based on input data of weather, fire weather, fuel, and terrain... Fire propagates over the terrain from a set of burning points around the fire perimeter, with directional rates of spread calculated accounting for wind, slope, and aspect... The probabilistic outputs derive from (1) the use of the multiple weather input streams and (2) probabilistic fire behaviour, where the fire spread during each simulated hour may be turned off according to dynamic thresholds. This compensates for FBP overprediction."*

A design requirement driving the 14-day (not 3-day) horizon is stated on p.136: *"Extend forecast horizons: Models should simulate fire behaviour until natural extinguishment. Fires can smoulder for weeks and reactivate later, so short-term forecasts are insufficient."* Even so, the prototype's actual horizon stopped at 14 days (p.136: "it was determined that full-season forecasts would only be used in special circumstances, not as part of the routine first approximation of risk") — i.e., the *intended* interpretation of burned area is "until natural extinction," but the *delivered* prototype product is a snapshot at day 14, not a fully burned-out simulation endpoint.

**"Lookout flags" for unreliable self-extinction/spread behaviour** (pp.142–143): FireSTARR flags include a "single red square" meaning *"the fire did not spread beyond 1 ha, possibly due to low burn conditions, surrounding non-fuel, or missing start-up indices"*; "very low overall burn probabilities" when the ignition lies in non-fuel, which can push FireSTARR to "search for nearby fuel," sometimes producing multiple starts; and an "illusion of spotting" artifact from grid geometry (diagonally touching fuel cells across a river falsely mimicking spot fire). These are documented as **interpretation caveats a user must apply to any burned-area-at-time-t output**, not statistical corrections.

**Gap:** The paper does **not** give a quantitative statement of how often smouldering/reactivation/self-extinction materially changes "burned area at day N" versus a simple fire-growth model without these mechanisms. It states the mechanisms exist and why they matter conceptually, but does not isolate their effect size.

---

## 5. Time handling

- **Spatial extent/resolution**: all of Ontario's fire region, ~92 million ha; **1-ha spatial resolution**, chosen as "a design decision based on several factors: available data, fire growth models, computational burden, and engagement with response personnel" (p.136). Explicitly not higher-resolution by design, to avoid "a misleading impression about the model accuracy" (p.136).
- **Temporal extent/resolution**: *"The original plan was to model fire growth from ignition through to the end of the fire season, which can be weeks or months ahead... the prototype version stopped at 14 days"* (p.136). Outputs are **snapshots, not continuous time series**, at the **end of days 1, 2, 3, 7, and 14** (day 7 described as "new," not matching prior 3-day operational practice; p.136–137). Each day's output is defined as the state at **23:59 local time**; day 1 begins "from the time and size of fire report or time of updated size" (p.137).
- So: the paper does **not** describe FireGUARD as a single "14-day burn probability product" — it is a **multi-horizon product delivered at five discrete lead times (1, 2, 3, 7, 14 days)**, each re-run from the latest fire state.
- **Update/automation triggers** (p.139): model runs were automatically triggered by (a) a new fire confirmed, (b) an existing fire's size updated, (c) a new fire perimeter saved, and (d) forecast updates (issued twice daily) — producing "rolling, up-to-date outputs that started from the latest fire size, perimeter, and weather forecast information."
- **How time is presented to users**: via the two-part PDF report structure (p.138) — Part 1 (Burn Probability) includes "thumbnail overviews of burn probabilities for each forecast day (1, 2, 3, 7, and 14) for quick reference" and "daily burn probability maps... clipped to the extent of simulated spread"; Part 2 (Impact and Risk) provides a risk map "for each forecast day (1, 2, 3, 7, and 14)" with the Total Risk scalar per day, enabling the day-to-day temporal comparison described in §3.
- Weather-side time handling (WeatherSHIELD) extends beyond 14 days using **analogue-year historical forecasts** past "the typical limit of numerical ensemble forecasts... day 15" (p.142), matched by sea-surface-temperature similarity to current conditions, with a stated subjective match-quality scale from "excellent" to "marginal or unusable."

---

## 6. Uptake, adoption, limitations, and what users asked for

- **Pilot/rollout**: 2018 — prototype made available to 3 of Ontario's 13 fire management sectors for feedback/evaluation; 2019 — available to all sectors as a "best effort" service; outputs were "included in many of Ontario's fire assessment reports for escaped, modified response or monitored fires in 2019"; the team won a 2019 Ontario Amethyst Award (digital disruption category) (p.142).
- **Mandatory suitability gate**: because the prototype was still R&D and data quality varied, users were **required to review and acknowledge a set of suitability checks before using outputs in decision-making** — "assess whether input data, model assumptions, and local conditions were appropriate for the current situation" (p.142). This is the direct precedent for Figs. 5/6's "checklist for suitability review and approval" in the PDF report (p.138).
- **Validation is explicitly distinguished from suitability/trust**: *"Validation for an operational DSS, however, may require more than peer review and abstract statistical validation. A complementary process is model suitability review, which asks whether a model is suitable for use in real-world decision-making applications. The work requires an iterative real-world testing, evaluation, feedback, and improvement"* (p.143). Component-level formal validation cited: WeatherSHIELD via Brier score and relative operating characteristic (Boychuk et al. 2020); RamPART via comparing model-ranked historical fires against AFFES staff rankings and statistical analysis against actual response decisions (p.143).
- **Scope creep driven directly by user requests**: the Resources-and-Assets (RA) CSV export (direction/distance from fire edge, average/max day-14 burn probability per asset) was explicitly **"requested by operational staff to enhance resource planning during active wildfire events"** and is described as extending "beyond the original R&D scope of FireGUARD" (p.141) — i.e., a named instance of users asking for something the core model didn't originally produce.
- **What the paper says FireGUARD could not yet do (stated as future work, p.143)**: (1) a landscape-level webservice display showing **multiple fires simultaneously as variable-sized circles sized by total risk score**, explicitly for "real-time triage by facilitating direct comparison of risk levels across multiple incidents" — this did not exist in the prototype and "would require further design work to integrate both spatial outputs and the contextual information currently found in the PDF products, ensuring interpretability"; (2) **agency performance measurement**: simulating self-extinguishing burn probability/risk under *observed* (not forecast) weather for historical fires and comparing to *actual* burned area/risk, as "an indication of the value of fire protection in terms of the averted losses"; (3) representing **spot fires**, a **fire benefits model** (currently risk is negative-impact-only; positive outcomes like ecosystem renewal were explicitly excluded, p.136), **off-site/cascading effects**, and integrating the already-built-but-unused **CostARMS** cost model (p.144).
- **CostARMS note**: "estimates the cost to AFFES of the alternative responses to monitor or suppress a fire over the life of the fire... At the time of this writing, the model was completed but was not implemented in the FireGUARD prototype" (p.137) — a fully specified cost-output model that never shipped.

---

## 7. Quantities a burn-probability-only platform cannot produce

Explicit in the paper, distinct from spatial burn probability alone:

1. **Impact** (RamPART): relative social/economic/emergency-response impact score per cell, independent of likelihood (Fig. 9 maximum-impact map).
2. **Risk** (likelihood-weighted impact): per-cell likelihood-weighted loss (Fig. 10), and the **Total Risk scalar** — a single number per fire per forecast day, explicitly designed to be comparable *across fires* for triage and *across days* for trend (p.140).
3. **Plain-language impact/risk interpretation** (Fig. 11): converting the abstract score into equivalent-loss statements fire managers can reason with ("a risk of 10 is like the loss of 200 ha of timber...").
4. **Resources-and-assets inventory export** (RA list, p.141): a filterable CSV of every point/areal asset within the burn-probability extent, with distance/direction from the fire edge and day-14 average/max burn probability per asset — not a map, a tabular values-at-risk product for incident management teams.
5. **Cost of response alternatives** (CostARMS): monitor-vs-suppress cost estimate over the life of the fire, built but unshipped (p.137, p.144) — flagged here as a *specified but unrealized* output type worth knowing about even though FireGUARD itself never produced it operationally.
6. **Fire-size ensemble statistics and class histogram** (Figs. 5, 7): population-level simulated-outcome statistics (min/avg/median/max, class-probability histogram) that a single deterministic or probability-only (per-cell) product cannot represent, because they require thinking in discrete simulated *fires*, not pixels.
7. **Weather/fire-weather uncertainty charts with analogue-year context** (Fig. 8, Fig. 12, WeatherSHIELD): ensemble percentile bands, climatological min/max/median context, and historical-analogue matching beyond the numerical ensemble horizon — inputs-side uncertainty communication that a burn-probability-only output hides.

---

## Implications for NOMAD

Recommendations are stated at the level of "what output should exist, in what form" — no claims are made about NOMAD's current internals, which were not reviewed for this note.

1. **Add a per-fire fire-size ensemble summary, per forecast horizon** (addressing ask #2). Minimum form matching the paper: a table of Min/Average/Median/Max final-area (ha) per simulated-horizon snapshot, plus a size-class histogram (log-ha bins) showing percent of simulations per class. Since the paper's own histogram was single-day, NOMAD should decide deliberately whether to repeat it at every horizon (1/2/3/7/14-day-style) rather than defaulting to one snapshot — the paper leaves this an open question, not a precedent to copy uncritically.
2. **Go further than the paper where it names a gap**: build the continuous fire-size-over-time chart with percentile bands (a fan chart) and an explicit exceedance-over-threshold view ("P(final size > X ha)"). The paper confirms demand for size-distribution thinking but never actually built either of these two chart forms — this is a genuine opportunity for NOMAD to exceed FireGUARD's own output, not merely replicate it.
3. **Decide explicitly whether NOMAD computes an impact layer and a combined risk layer**, or burn probability only. If NOMAD intends to support "risk," it needs an analogue to RamPART (an impact-per-cell layer from asset data, independent of FireSTARR) before likelihood-weighted risk becomes meaningful — this is a data and modeling dependency, not just a UI chart, and should be scoped as its own design question.
4. **If a risk layer is added, include a Total Risk scalar per fire per horizon**, designed from the start to be comparable across fires (for triage) and across time (for trend) — this was the single most operationally cited feature of FireGUARD's risk section (p.140, p.143's stated future work on multi-fire triage display).
5. **Represent smouldering/reactivation/self-extinction explicitly in any "burned area at time t" output, or document their absence.** If FireSTARR as used by NOMAD does not model these (unverified — outside this note's scope), any burned-area or size output should carry an explicit caveat, mirroring the paper's "lookout flags" pattern, rather than presenting area-at-time-t as if it reflects eventual fire behaviour.
6. **Present forecast horizons as discrete labeled snapshots** (matching the paper's day 1/2/3/7/14 pattern or a horizon set NOMAD chooses deliberately), each clearly dated and re-runnable from updated fire state/perimeter — not as a single fixed "14-day" product.
7. **Consider a resources-and-assets export** (filterable table: asset, distance/direction from fire, burn probability at a chosen horizon) as a candidate output — explicitly named by the paper as a user-requested, high-value, low-complexity addition beyond the core spatial model.
8. **Treat cost-of-response as a known, previously-specified-but-unshipped output type** (CostARMS) worth scoping deliberately for NOMAD rather than rediscovering from scratch, if cost estimation is ever requested.
9. **Build in an interpretation-aid convention** (plain-language equivalence statements for abstract scores) for any new scored/aggregated output NOMAD introduces — the paper identifies this as necessary specifically because a "newly formulated" risk/impact score is not self-explanatory to operational users (p.142).

No file was overwritten; the target path did not previously exist.
