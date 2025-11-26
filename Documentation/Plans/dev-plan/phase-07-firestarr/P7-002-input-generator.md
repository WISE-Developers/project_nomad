# P7-002: FireSTARR Input File Generator

## Description
Create service to generate FireSTARR input files from domain models.

## Acceptance Criteria
- [ ] Generate weather CSV in FireSTARR format (Scenario,Date,PREC,TEMP,RH,WS,WD,...)
- [ ] Generate perimeter TIF from input geometry
- [ ] Create simulation directory structure
- [ ] Write configuration parameters to appropriate files
- [ ] Validate all required inputs present before generation

## Dependencies
- P7-001 (FireSTARR Adapter)
- P1-001 (Domain Entities)

## Estimated Time
3-4 hours

## Files to Create/Modify
- `backend/src/infrastructure/engines/firestarr/InputGenerator.ts`
- `backend/src/infrastructure/engines/firestarr/WeatherCSVWriter.ts`

## Notes
- Weather CSV format is strict - see firestarr_io.md for exact columns
- Column order: Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI
- Date format: YYYY-MM-DD HH:MM:SS
