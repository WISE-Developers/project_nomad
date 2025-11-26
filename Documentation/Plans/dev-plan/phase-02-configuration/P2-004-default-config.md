# P2-004: Generic Default Configuration File

## Description
Create the default/generic configuration file that ships with the open-source release.

## Acceptance Criteria
- [ ] Create `/configuration/generic/config.json` with all required sections
- [ ] Include placeholder data sources (can be overridden by agencies)
- [ ] Set default models to ["firestarr"] (WISE added post-MVP)
- [ ] Include all export options enabled by default
- [ ] Add inline comments explaining each section (JSON5 or separate README)
- [ ] Validate JSON is syntactically correct

## Dependencies
- P2-001 (Configuration Types)

## Estimated Time
1-2 hours

## Files to Create/Modify
- `configuration/generic/config.json`
- `configuration/generic/README.md` (explains config options)
- `configuration/.gitkeep` (ensure folder tracked)

## Notes
- This is the baseline that agencies customize
- Keep it minimal but complete
- Reference NWT demo config for structure
