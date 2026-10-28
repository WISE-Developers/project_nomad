import { describe, it, expect } from 'vitest';
import {
  parseSizesCsv,
  summariseFireSizes,
  SIZES_FILENAME_RE,
  parseSizesFilename,
} from '../fireSizeSeries.js';

/**
 * Every fixture here is a MEASURED value from a real run directory, not an
 * invention. Provenance is named per case so a future reader can re-measure it
 * rather than trust this file.
 */
describe('parseSizesCsv', () => {
  it('parses plain integer rows exactly (run c7ea0072, sizes_176_2023-06-25.csv)', () => {
    const r = parseSizesCsv('209352\n227341\n');
    expect(r.sizesHa).toEqual([209352, 227341]);
    expect(r.n).toBe(2);
  });

  it('parses %g scientific notation rather than yielding NaN (run 555dccae, sizes_170)', () => {
    // FireSTARR writes large values to six significant figures. A parser that
    // assumes integer digits returns NaN here, and NaN reaching the engine is
    // the failure mode this test exists to prevent.
    const r = parseSizesCsv('1.64288e+06\n1.64288e+06\n');
    expect(r.sizesHa).toEqual([1642880, 1642880]);
    expect(r.sizesHa.every(v => Number.isFinite(v))).toBe(true);
  });

  it('flags values written in reduced precision, because 1.64288e+06 is not 1642885', () => {
    // The log for that same run says 1642885.0 ha. The CSV cannot express it.
    const r = parseSizesCsv('1.64288e+06\n');
    expect(r.reducedPrecision).toBe(true);
    const exact = parseSizesCsv('209352\n227341\n');
    expect(exact.reducedPrecision).toBe(false);
  });

  it('takes N from its own row count and nothing else', () => {
    // Run c7ea0072 logs "Ran 6 simulations" while every one of its CSVs holds
    // 2 rows. N is a property of the file.
    const r = parseSizesCsv('186994\n186994\n');
    expect(r.n).toBe(2);
  });

  it('tolerates trailing and blank lines without inventing a row', () => {
    const r = parseSizesCsv('1\n\n2\n\n');
    expect(r.sizesHa).toEqual([1, 2]);
    expect(r.n).toBe(2);
  });

  it('THROWS on an empty file rather than reporting a zero-sized ensemble', () => {
    // A silent default is a lie: N=0 would render as a real distribution.
    expect(() => parseSizesCsv('\n  \n')).toThrow(/no fire sizes/i);
  });

  it('THROWS on an unparseable row rather than dropping it', () => {
    expect(() => parseSizesCsv('209352\nnot-a-number\n')).toThrow(/not-a-number/);
  });
});

describe('summariseFireSizes', () => {
  it('WITHHOLDS the median and percentiles while #429 is open', () => {
    // #418's blocking prerequisite, verbatim: "Do not compute a median or a
    // percentile until it is answered, or we will publish a statistic over an
    // unknown population." #429 is that question.
    //
    // Measured evidence for why: run c7ea0072 logs six simulations with six
    // distinct final sizes while sizes_176_2023-06-25.csv holds two rows. N is
    // a ROW count, so the rows are an unknown subset of the ensemble.
    //
    // THE MEASUREMENTS THIS REPLACES ARE KEPT HERE, because they are real and
    // will be needed the moment #429 closes — FireSTARR's logged median is the
    // upper middle value on an even ensemble, not a median:
    //   run 17fc56ad: values 6224 and 6714 -> logged 6714, true median 6469
    //   run 053dee34: N=46 -> logged 3088, true median 3079
    //   odd N agrees, which is why the defect is easy to miss: [1, 3229, 9000]
    // The implementation that satisfied them is in git, removed rather than
    // left dormant so nothing reintroduces it by wiring up an existing field.
    const s = summariseFireSizes([6224, 6714]);
    expect(s).not.toHaveProperty('medianHa');
    expect(s).not.toHaveProperty('percentilesHa');
  });

  it('reproduces the logged mean, which is the check that the CSV is the population', () => {
    // Run c7ea0072 day 7: log says mean 218346.5 over 209352 and 227341.
    const s = summariseFireSizes([209352, 227341]);
    expect(s.meanHa).toBe(218346.5);
    expect(s.minHa).toBe(209352);
    expect(s.maxHa).toBe(227341);
  });

  it('always states N, and still describes the rows it does have', () => {
    // The control for the withholding test above: without it, returning an
    // empty object would satisfy "no median, no percentiles".
    const s = summariseFireSizes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.n).toBe(10);
    expect(s.minHa).toBe(1);
    expect(s.maxHa).toBe(10);
    expect(s.meanHa).toBe(5.5);
  });

  it('marks a degenerate distribution instead of presenting it as a spread', () => {
    // 33 of 194 real size files hold a single repeated value.
    const s = summariseFireSizes([186994, 186994]);
    expect(s.degenerate).toBe(true);
    expect(summariseFireSizes([1, 2]).degenerate).toBe(false);
  });

  it('refuses to summarise nothing', () => {
    expect(() => summariseFireSizes([])).toThrow(/empty/i);
  });
});

describe('parseSizesFilename', () => {
  it('reads the julian day and date', () => {
    expect(parseSizesFilename('sizes_176_2023-06-25.csv')).toEqual({
      julianDay: 176,
      date: '2023-06-25',
    });
  });

  it('accepts the dateless form the export manifest also allows', () => {
    expect(parseSizesFilename('sizes_176.csv')).toEqual({ julianDay: 176, date: null });
  });

  it('rejects a non-sizes filename', () => {
    expect(parseSizesFilename('probability_176_2023-06-25.tif')).toBeNull();
  });

  it('exports a regex that matches the export manifest\'s accepted shapes', () => {
    expect(SIZES_FILENAME_RE.test('sizes_1_2026-01-01.csv')).toBe(true);
    expect(SIZES_FILENAME_RE.test('sizes_1.csv')).toBe(true);
    expect(SIZES_FILENAME_RE.test('sizes_.csv')).toBe(false);
  });
});
