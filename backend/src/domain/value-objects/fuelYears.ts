/**
 * Fuel vintage vs dataset year — issue #431.
 *
 * Two different years are involved and NOMAD used to conflate them, displaying
 * the model year under the label "fuel vintage":
 *
 *   - DATASET YEAR  what is installed and keyed on. The dataset index calls the
 *                   2026 dataset "start-of-2026 fuels; input for 2026 model
 *                   runs", so the dataset year equals the model year it serves.
 *   - FUEL VINTAGE  the season the fuel data actually describes, which is one
 *                   year earlier, because disturbance mapping lags the season it
 *                   describes. There are no 2026 fuels until the 2026 season has
 *                   happened.
 *
 *   fuel vintage = dataset year - 1
 *
 * This rule lives in the domain because it is a fact about fire data, not about
 * a screen or an endpoint. It is the ONE place the relationship is expressed;
 * every API payload and every display derives from here rather than re-deriving,
 * so the two numbers cannot drift apart again.
 *
 * Nothing persisted is affected. The dataset index, the installer, the directory
 * names, `dataset.json` and the per-run recorded vintage all keep their existing
 * field names and meanings — renaming any of those would either break installed
 * systems or rewrite what completed runs claim about themselves, which is the
 * failure #331 closed.
 */

/**
 * The fuel vintage carried by a given dataset year.
 *
 * Returns undefined when the dataset year is unknown or not a whole year — the
 * `default` dataset directory carries no year of its own, and `Number('default')`
 * is NaN. An inferred vintage is worse than none: it is the error no downstream
 * reader can catch, because nothing on screen reveals it was a guess (#331).
 */
export function fuelVintageForDatasetYear(datasetYear: number | undefined): number | undefined {
  if (!Number.isInteger(datasetYear)) {
    return undefined;
  }

  return (datasetYear as number) - 1;
}
