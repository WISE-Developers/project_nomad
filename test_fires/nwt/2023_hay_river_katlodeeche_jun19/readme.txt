2023_NT_SS005-23 — Hay River / K'atl'odeeche, 19 June 2023
==========================================================

Real fire, real weather. Used as a verification case: if a change breaks
fire behaviour, it should show up here.

  ignition        60.82195581654469 N, -115.70618034667032 W
  start           2023-06-19 13:00:00 -06:00
  duration        241 hours
  source job      job_20230619134600244   (see metadata.json)

WHICH WEATHER FILE TO USE
-------------------------

  weather.csv          <- THE REAL WEATHER. Use this one.
                          2023-06-19 06:00 -> 2023-06-29 06:00, 240 hourly rows.

  2021-weather.csv     Alternates. NOT what this fire actually burned under.
  2024-weather.csv     Only use these when you deliberately want a different
                       year's fuel state, and say so in whatever you report.

The year-named files are easy to mistake for the real record because the
directory is named 2023 and neither of them is. They are not the fire. The
unprefixed `weather.csv` is.

This is deliberate, and knowing why stops you "fixing" it.

Verified 2026-09-22: all three files are IDENTICAL apart from the year in
the Date column — same 240 rows, same PREC/TEMP/RH/WS/WD and same FWI
values throughout. The alternates are not different weather. They are this
weather re-stamped to another year, so that the run picks up a different
fuel file (fuel dataset is selected by date), while every other input stays
fixed.

That makes fuel vintage the only variable in the experiment: run the same
fire, under the same weather, against a different year's fuel state, and
any difference in the output is attributable to the fuel alone.

So do not "correct" the alternates to carry real 2021 or 2024 weather.
That would introduce a second variable and destroy what they are for.

MATCH THE FUEL DATASET TO THE WEATHER YEAR
------------------------------------------

The dataset index states the convention plainly:

    "vintage = run year (start-of-year fuel state);
     a run in year N uses dataset N"

  weather.csv        -> FireSTARR_Fuel_2023_V1.0.zip
  2021-weather.csv   -> FireSTARR_Fuel_2021 (if published)
  2024-weather.csv   -> FireSTARR_Fuel_2024_V1.0.zip

Getting this pairing wrong does not fail loudly. It models the right fire
against the wrong year's fuel and returns a perfectly plausible perimeter,
with nothing in the output saying which fuel state produced it. Check the
pairing before trusting a comparison.

Index: https://fgmfiles.spyd.com/datasets/nomad/index.json

OTHER FILES
-----------

  ignition.geojson         ignition polygon (also .shp/.dbf/.prj/.shx/.kml)
  my_bad_ignition.geojson  a second ignition geometry. Purpose not recorded
                           here — the name suggests a known-bad case kept for
                           testing, but that is not documented, so confirm
                           before using it for anything.
  metadata.json            job id, ignition point, start time, duration,
                           starting FWI codes (FFMC 84, DMC 53, DC 564)
  Archive/ , Archive.zip   earlier copies of the ignition shapefile set
