/**
 * Tests for POST /api/v1/perimeters/import (refs #267).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import perimetersImportRouter from '../perimetersImport.js';
import { errorHandler } from '../../../middleware/errorHandler.js';

const VALID_GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-115.7, 60.8],
            [-115.7, 60.81],
            [-115.69, 60.81],
            [-115.69, 60.8],
            [-115.7, 60.8],
          ],
        ],
      },
    },
  ],
});

describe('POST /api/v1/perimeters/import — GeoJSON', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use('/api/v1', perimetersImportRouter);
    app.use(errorHandler);
  });

  it('returns 201 + normalized FeatureCollection for a valid GeoJSON upload', async () => {
    const res = await request(app)
      .post('/api/v1/perimeters/import')
      .attach('file', Buffer.from(VALID_GEOJSON), 'ignition.geojson');

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('FeatureCollection');
    expect(res.body.features).toHaveLength(1);
    expect(res.body.features[0].geometry.type).toBe('Polygon');
  });

  it('returns 400 + structured fieldErrors for malformed GeoJSON', async () => {
    const res = await request(app)
      .post('/api/v1/perimeters/import')
      .attach('file', Buffer.from('not json {'), 'ignition.geojson');

    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors).toBeDefined();
    expect(res.body.error.details.fieldErrors[0].field).toBe('content');
  });

  it('returns 400 for an unsupported file extension', async () => {
    const res = await request(app)
      .post('/api/v1/perimeters/import')
      .attach('file', Buffer.from(VALID_GEOJSON), 'ignition.shp');

    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors[0].field).toBe('filename');
  });

  it('returns 400 when no file is uploaded', async () => {
    const res = await request(app).post('/api/v1/perimeters/import');
    expect(res.status).toBe(400);
  });
});

const VALID_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              -115.7,60.8 -115.7,60.81 -115.69,60.81 -115.69,60.8 -115.7,60.8
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

describe('POST /api/v1/perimeters/import — KML', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use('/api/v1', perimetersImportRouter);
    app.use(errorHandler);
  });

  it('returns 201 + normalized FeatureCollection for a valid KML upload', async () => {
    const res = await request(app)
      .post('/api/v1/perimeters/import')
      .attach('file', Buffer.from(VALID_KML), 'ignition.kml');

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('FeatureCollection');
    expect(res.body.features).toHaveLength(1);
    expect(res.body.features[0].geometry.type).toBe('Polygon');
  });

  it('returns 400 + structured fieldErrors for malformed KML', async () => {
    const res = await request(app)
      .post('/api/v1/perimeters/import')
      .attach('file', Buffer.from('<<not xml>>'), 'ignition.kml');

    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors[0].field).toBe('content');
  });
});
