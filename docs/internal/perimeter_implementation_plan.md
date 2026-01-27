# Perimeter Implementation Correction Plan

**Date:** 2026-01-26
**Source:** Dev team meeting feedback + Jordan Evens (FireSTARR author)
**Status:** Internal planning - awaiting formal issue assignment

---

## Background

Feedback from dev team meeting identified issues with current perimeter implementation.

## Key Issues Identified

### 1. Probability Rasters Cannot Be Converted to Perimeters
- Converting probability rasters to perimeters causes **inaccuracy**
- Creates **confusion for end users**
- Probability data is continuous/gradient - perimeters imply discrete boundaries
- Users may misinterpret probabilistic output as deterministic boundaries

### 2. Correct Approach: FireSTARR `-i` Flag + Arrival Grid

Per Jordan (FireSTARR author):

**Run FireSTARR with `-i` flag**
- Eliminates stochasticity (deterministic single-run mode)
- Outputs additional rasters per scenario:
  - `arrival.tif` - when fire arrives at each cell
  - `intensity.tif` - fire intensity
  - `raz.tif` - rate of spread azimuth (direction)
  - `ros.tif` - rate of spread
  - `source.tif` - ignition source

**Perimeter extraction method:**
- Use the **arrival grid**
- Filter by temporal parameter (time T)
- Cells where `arrival <= T` = fire boundary at time T
- This is deterministic, not probabilistic

### 3. Arrival Grid Time Format (from Jordan)

The arrival raster values encode time as:
```
arrival_value = day_of_year + (hour + (minute / 60)) / 24
```

**Examples:**
| Time | Calculation | Value |
|------|-------------|-------|
| Day 155 @ 12:00 | 155 + (12/24) | 155.5 |
| Day 155 @ 18:00 | 155 + (18/24) | 155.75 |
| Day 155 @ 15:30 | 155 + (15.5/24) | 155.6458 |

**UI Implication:** This enables a temporal slider - user scrubs through time, we filter `arrival <= slider_value` to show fire progression frame by frame.

### 4. FireSTARR Version: Use `unstable` Branch

**Critical:** We've been working with an outdated FireSTARR version.

- **Wrong:** `main` or `dev` branches
- **Correct:** `unstable` branch

The `-i` flag and additional raster outputs (arrival, intensity, raz, ros, source) require the unstable branch.

---

## Implementation Summary

1. Update FireSTARR to `unstable` branch
2. Add `-i` flag to FireSTARR execution
3. Parse arrival grid instead of probability rasters
4. Implement time-based filtering: `arrival <= T` for perimeter at time T
5. Remove/deprecate probability-to-perimeter conversion code
