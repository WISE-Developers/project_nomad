/**
 * Port: read which fuel dataset vintages are installed, and which one a given
 * model year actually resolves to (refs #319).
 *
 * Fuel datasets are installed one directory per vintage year. Fuel lookup
 * prefers {year}/ and falls back to default/, and that fallback used to be
 * silent — the user could not tell which fuel their run consumed. This port
 * exists so the resolution can be reported honestly to the UI.
 *
 * Naming, corrected in #431. Two years are involved and they must not be
 * conflated:
 *
 *   - datasetYear   what is installed and keyed on. The index calls the 2026
 *                   dataset "start-of-2026 fuels; input for 2026 model runs",
 *                   so the dataset year equals the model year it serves.
 *   - fuelVintage   the season the fuel data describes: datasetYear - 1. See
 *                   domain/value-objects/fuelYears.ts, which owns the rule.
 *
 * The field was previously called `vintage` and carried the DATASET year, so
 * every consumer displaying it as a vintage was off by one. The on-disk names
 * (`dataset.json`, the index, the directory names, the per-run recorded vintage)
 * are deliberately unchanged: renaming those would break installed systems or
 * rewrite what completed runs claim, which is the failure #331 closed.
 */

/** Provenance for one installed vintage, as written by the installer. */
export interface FuelDataset {
  /** Dataset year: the model year this dataset is the start-of-year state for. */
  readonly datasetYear: number;
  /** Dataset edition, e.g. "1.0". */
  readonly edition?: string;
  /** Human-readable description of the vintage. */
  readonly label?: string;
  /** Who produced the UTM grids. */
  readonly producer?: string;
  /** Upstream provider, e.g. "NRCan/CFS". */
  readonly provider?: string;
  /** When the dataset was packaged (ISO date). */
  readonly buildDate?: string;
  /** Grid resolution in metres. */
  readonly resolutionM?: number;
}

/**
 * Outcome of resolving a model year against what is installed.
 *
 * Deliberately reports HOW it resolved, not just what: "fell back to default"
 * and "exact match" mean different things to someone reading a fire model.
 */
export interface ResolvedFuelDataset {
  /** The year that was asked for. */
  readonly requestedYear: number;
  /** Dataset year that will actually be used; undefined when nothing resolved. */
  readonly datasetYear?: number;
  /**
   * Vintage of the fuel data itself — datasetYear - 1, derived once in the
   * domain. Undefined when no dataset year resolved; never inferred.
   */
  readonly fuelVintage?: number;
  /** True when a dataset for requestedYear is installed. */
  readonly matchedRequestedYear: boolean;
  /** True when the requested year was absent and default/ was used instead. */
  readonly usedFallback: boolean;
  /** Provenance of the resolved dataset, when one resolved. */
  readonly dataset?: FuelDataset;
}

export interface IFuelDatasetCatalog {
  /** All installed datasets, ascending by dataset year. */
  listInstalled(): Promise<FuelDataset[]>;

  /**
   * Resolve a model year the same way fuel lookup does: {year}/ then default/.
   * Must mirror FireSTARRInputGenerator.findFuelGridForCoordinates — a catalog
   * that disagrees with the generator would report a vintage never used.
   */
  resolveForYear(modelYear: number): Promise<ResolvedFuelDataset>;
}
