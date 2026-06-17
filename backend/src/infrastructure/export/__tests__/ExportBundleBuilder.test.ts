import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Fakes for the builder's collaborators (external I/O / services) ---
const getResultById = vi.fn();

vi.mock('fs/promises', () => ({
  stat: vi.fn(async () => ({ size: 1234 })),
}));

vi.mock('../../../application/services/index.js', () => ({
  getModelResultsService: vi.fn(() => ({ getResultById })),
}));

vi.mock('../../firestarr/index.js', () => ({
  getFireSTARREngine: vi.fn(() => ({})),
}));

vi.mock('../../firestarr/FireSTARRInputGenerator.js', () => ({
  resolveResultFilePath: vi.fn((p: string) => `/abs/${p}`),
}));

vi.mock('../FormatConverter.js', () => ({
  getFormatConverter: vi.fn(() => ({
    convert: vi.fn(async () => '/abs/converted.geojson'),
  })),
}));

vi.mock('../ExportFormatRegistry.js', () => ({
  getExportFormatRegistry: vi.fn(() => ({
    getFormats: () => [{ id: 'geojson' }, { id: 'shp' }],
    canConvert: () => false,
  })),
}));

import { ExportBundleBuilder } from '../ExportBundleBuilder.js';

beforeEach(() => {
  getResultById.mockReset();
});

describe('ExportBundleBuilder.build()', () => {
  it('throws when no model is set', async () => {
    const builder = new ExportBundleBuilder();
    await expect(builder.addItem('r1').build()).rejects.toThrow('Model ID is required');
  });

  it('throws when no items are added', async () => {
    const builder = new ExportBundleBuilder();
    await expect(builder.forModel('m1').build()).rejects.toThrow('At least one item is required');
  });

  it('assembles a bundle with items, manifest shape, paths, formats and sizes', async () => {
    getResultById.mockResolvedValue({
      result: {
        format: 'GEOJSON',
        metadata: { filePath: 'results/r1.geojson' },
        getDisplayName: () => 'Output One',
      },
    });

    const bundle = await new ExportBundleBuilder()
      .forModel('m1', 'My Model')
      .addItem('r1')
      .build();

    expect(bundle.id).toBeTypeOf('string');
    expect(bundle.modelId).toBe('m1');
    expect(bundle.createdAt).toBeInstanceOf(Date);

    expect(bundle.items).toHaveLength(1);
    const item = bundle.items[0];
    expect(item.outputName).toBe('Output One');
    expect(item.originalFormat).toBe('GEOJSON');
    expect(item.exportFormat).toBe('geojson');
    expect(item.filePath).toBe('/abs/results/r1.geojson');
    expect(item.fileSize).toBe(1234);

    expect(bundle.manifest).toMatchObject({
      modelName: 'My Model',
      modelId: 'm1',
      itemCount: 1,
      totalSize: 1234,
      items: [{ name: 'Output One', format: 'geojson', size: 1234 }],
    });
    expect(bundle.manifest.createdAt).toBeTypeOf('string');
  });

  it('throws when a requested result is missing', async () => {
    getResultById.mockResolvedValue(null);
    await expect(
      new ExportBundleBuilder().forModel('m1').addItem('nope').build()
    ).rejects.toThrow('Result not found: nope');
  });
});
