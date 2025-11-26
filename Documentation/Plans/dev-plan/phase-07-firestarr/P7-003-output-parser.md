# P7-003: FireSTARR Output Parser

## Description
Create service to parse FireSTARR output files into domain models.

## Acceptance Criteria
- [ ] Parse probability TIF files (probability_<julian_day>_<date>.tif)
- [ ] Parse fire perimeter outputs
- [ ] Parse summary statistics if available
- [ ] Map output files to ModelResult entity
- [ ] Handle missing/incomplete outputs gracefully

## Dependencies
- P7-001 (FireSTARR Adapter)
- P1-001 (ModelResult entity)

## Estimated Time
3 hours

## Files to Create/Modify
- `backend/src/infrastructure/engines/firestarr/OutputParser.ts`

## Notes
- Outputs are in FIRESTARR_DATASET_PATH/sims/
- Consider using GDAL bindings for TIF metadata
