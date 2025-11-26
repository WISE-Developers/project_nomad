# P5-004: Weather Data Step

## Description
Create the step for weather data configuration and FWI index input.

## Acceptance Criteria
- [ ] Create `WeatherStep` component
- [ ] Auto-detect forecast vs historical based on temporal inputs
- [ ] Input fields for FWI indices (FFMC, DMC, DC, ISI, BUI, FWI)
- [ ] Placeholder for SpotWX API integration (future)
- [ ] Option to upload weather CSV file
- [ ] Show weather preview/summary

## Dependencies
- P4-001 (Wizard Container)
- P1-002 (FWIIndices value object)

## Estimated Time
3-4 hours

## Files to Create/Modify
- `frontend/src/features/ModelSetup/steps/WeatherStep.tsx`
- `frontend/src/features/ModelSetup/components/FWIInput.tsx`
- `frontend/src/features/ModelSetup/components/WeatherUpload.tsx`

## Notes
- FWI indices are critical for fire behavior prediction
- SpotWX integration is separate enhancement
