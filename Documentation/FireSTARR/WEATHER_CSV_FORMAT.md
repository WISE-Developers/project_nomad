# FireSTARR Weather CSV Format

This is the format FireSTARR consumes directly. If you already have hourly weather plus pre-calculated Canadian FWI System indices, save them in this layout and upload via the **FireSTARR CSV** tab in the weather step.

If you do not have pre-calculated FWI values, use the **Raw Weather + Codes** tab instead — Nomad will compute FWI from the raw observations and the previous day's startup codes.

## Column header

```
Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI
```

Column names are case-insensitive on import; FireSTARR writes them as shown above.

## Column reference

| Column | Meaning | Units / Range |
|---|---|---|
| `Scenario` | Weather scenario index. Use `0` for a single deterministic scenario; integers `0..N-1` for ensemble runs. | integer |
| `Date` | Local observation timestamp. | `YYYY-MM-DD HH:MM:SS` |
| `PREC` | Precipitation in the last hour. | mm |
| `TEMP` | Temperature. | °C |
| `RH` | Relative humidity. | % (0–100) |
| `WS` | Wind speed at 10 m. | km/h |
| `WD` | Wind direction (where the wind is coming **from**). | degrees true (0–360) |
| `FFMC` | Fine Fuel Moisture Code. | unitless, typically 0–101 |
| `DMC` | Duff Moisture Code. | unitless, typically 0–150+ |
| `DC` | Drought Code. | unitless, typically 0–800+ |
| `ISI` | Initial Spread Index. | unitless |
| `BUI` | Buildup Index. | unitless |
| `FWI` | Fire Weather Index. | unitless |

## Example

Three hours of one scenario starting 06:00 local on June 19, 2023:

```csv
Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI
0,2023-06-19 06:00:00,0.0,8.2,73.0,5.0,20.0,83.5,53.7,568.9,2.21,86.84,9.46
0,2023-06-19 07:00:00,0.0,10.3,63.0,6.0,18.0,83.5,54.8,574.1,2.34,88.45,10.05
0,2023-06-19 08:00:00,0.0,12.2,54.0,8.0,16.0,84.7,56.4,579.7,3.03,90.71,12.57
```

## Notes

- **Hourly cadence is required.** FireSTARR expects one row per hour starting at the simulation start hour.
- **Date must be in local time** matching the model's configured timezone. Nomad does not adjust the timestamps on your behalf.
- **Multiple scenarios** are supplied by repeating the time series under different `Scenario` integers in the same file.
- **FWI System reference:** Canadian Forest Service Forestry Technical Report 35 (Van Wagner, 1987) for the calculation methodology; values you supply here are passed through to FireSTARR as authoritative — they are not recomputed.
