# P9-001: Export Format Registry

## Description
Create registry of supported export formats with conversion capabilities.

## Acceptance Criteria
- [ ] Create `ExportFormatRegistry` service
- [ ] Register vector formats: GeoJSON, KML, Shapefile
- [ ] Register raster formats: GeoTIFF, PNG
- [ ] Define format metadata (name, extension, mime type)
- [ ] Method to check format compatibility with output type
- [ ] Extensible design for adding new formats

## Dependencies
- P1-001 (Domain Entities)

## Estimated Time
2-3 hours

## Files to Create/Modify
- `backend/src/infrastructure/export/ExportFormatRegistry.ts`
- `backend/src/infrastructure/export/formats/index.ts`
- `backend/src/infrastructure/export/formats/GeoJSONFormat.ts`
- `backend/src/infrastructure/export/formats/ShapefileFormat.ts`

## Notes
- Use Turf.js for vector format conversions
- Consider GDAL for raster format conversions
