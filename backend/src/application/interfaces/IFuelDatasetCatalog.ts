/**
 * Port: read which fuel dataset vintages are installed, and which one a given
 * model year actually resolves to (refs #319).
 *
 * Fuel datasets are installed one directory per vintage year. Fuel lookup
 * prefers {year}/ and falls back to default/, and that fallback used to be
 * silent — the user could not tell which fuel their run consumed. This port
 * exists so the resolution can be reported honestly to the UI.
 *
 * Convention: vintage = RUN year (start-of-year fuel state). A run in year N
 * uses dataset N. It is not off-by-one.
 */

/** Provenance for one installed vintage, as written by the installer. */
export interface FuelDataset {
  /** Run year this dataset is the fuel state for. */
  readonly vintage: number;
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
  /** Vintage that will actually be used; undefined when nothing resolved. */
  readonly vintage?: number;
  /** True when a dataset for requestedYear is installed. */
  readonly matchedRequestedYear: boolean;
  /** True when the requested year was absent and default/ was used instead. */
  readonly usedFallback: boolean;
  /** Provenance of the resolved dataset, when one resolved. */
  readonly dataset?: FuelDataset;
}

export interface IFuelDatasetCatalog {
  /** All installed vintages, ascending by year. */
  listInstalled(): Promise<FuelDataset[]>;

  /**
   * Resolve a model year the same way fuel lookup does: {year}/ then default/.
   * Must mirror FireSTARRInputGenerator.findFuelGridForCoordinates — a catalog
   * that disagrees with the generator would report a vintage never used.
   */
  resolveForYear(modelYear: number): Promise<ResolvedFuelDataset>;
}
