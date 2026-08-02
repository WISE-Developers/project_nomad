/**
 * FireSTARREngine — fuel vintage year used for coverage validation (refs #319)
 *
 * validateLocation() checked fuel coverage against `new Date().getFullYear()`
 * while the actual run generates inputs against `params.startDate.getFullYear()`
 * (FireSTARRInputGenerator). Validation and execution could therefore consult
 * two different fuel vintages: modelling a 2023 fire today validated against
 * 2026 fuels but ran on 2023 fuels.
 *
 * Because fuel lookup silently falls back {year}/ -> default/, that mismatch is
 * invisible: it either passes validation and runs on fuel that was never
 * checked, or fails with "No fuel grid coverage at this location" when the
 * location is fine and only that vintage is missing.
 *
 * The model year is now a REQUIRED argument — defaulting it to "today" is the
 * bug, so there is no default.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { FireSTARREngine } from '../FireSTARREngine.js';
import { Result } from '../../../application/common/index.js';
import type { IContainerExecutor } from '../../../application/interfaces/IContainerExecutor.js';
import type { IInputGenerator, InputGenerationResult } from '../../../application/interfaces/IInputGenerator.js';
import type { IOutputParser, ParsedOutput } from '../../../application/interfaces/IOutputParser.js';
import type { FireSTARRParams } from '../types.js';
import { Coordinates } from '../../../domain/value-objects/index.js';

/** Hay River, NWT — inside Canadian coverage bounds. */
const HAY_RIVER = new Coordinates(60.82, -115.7);

describe('FireSTARREngine.validateLocation — fuel vintage year', () => {
  let tempDir: string;
  let engine: FireSTARREngine;
  let findFuelGridForCoordinates: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'firestarr-fuelyear-test-'));

    // Stand in for FireSTARRInputGenerator: record the year it is asked for.
    findFuelGridForCoordinates = vi
      .fn()
      .mockResolvedValue(join(tempDir, 'generated', 'grid', '100m', '2023', 'fuel_11_0.tif'));

    const mockInputGenerator = {
      generate: vi.fn().mockResolvedValue(Result.ok({
        workingDir: tempDir,
        weatherFile: join(tempDir, 'weather.csv'),
        configFiles: [],
      } as InputGenerationResult)),
      cleanup: vi.fn(),
      findFuelGridForCoordinates,
    } as unknown as IInputGenerator<FireSTARRParams>;

    const mockExecutor = {
      run: vi.fn(),
      runStream: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
      isServiceAvailable: vi.fn().mockResolvedValue(true),
    } as unknown as IContainerExecutor;

    const mockParser = {
      parse: vi.fn().mockResolvedValue(Result.ok([])),
      parseLog: vi.fn().mockResolvedValue({ success: true, durationSeconds: 1 }),
    } as unknown as IOutputParser<ParsedOutput[]>;

    engine = new FireSTARREngine(mockExecutor, mockInputGenerator, mockParser);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('validates coverage against the model year, not the current year', async () => {
    const modelYear = 2023;
    const thisYear = new Date().getFullYear();
    expect(modelYear).not.toBe(thisYear); // guard: the test must be meaningful

    await engine.validateLocation(HAY_RIVER, modelYear);

    expect(findFuelGridForCoordinates).toHaveBeenCalledWith(
      HAY_RIVER.latitude,
      HAY_RIVER.longitude,
      modelYear
    );
  });

  it('passes a future model year straight through rather than clamping to today', async () => {
    const modelYear = new Date().getFullYear() + 1;

    await engine.validateLocation(HAY_RIVER, modelYear);

    const yearArg = findFuelGridForCoordinates.mock.calls[0]?.[2];
    expect(yearArg).toBe(modelYear);
  });
});
