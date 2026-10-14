---
title: Welcome to
---

![Nomad](/nomad-logo.png)

## What's new

Before a run starts
- A fire too large for FireSTARR's grid is now refused before the run begins, with an explanation of why. A merely large one warns you and carries on, saying where the limit sits. Until now the engine quietly cropped the simulation and told you nothing about what it had left out
- Weather problems are explained before a model starts, naming the day and what to change, rather than failing part-way through with an exit code

While a model runs
- The execution log scrolls again after you resize the panel
- If the connection carrying status updates drops, the notice now says it has lost contact instead of spinning as though the job were still going. Your run is unaffected — only our view of it was

Results and setup
- The fuel vintage shown is the vintage of the fuel data, not the year of the model, and each run records who produced the fuel it used. Installing a dataset later never changes what a past run reports
- A missing fuel dataset names the year it needs and lists the years installed

Automation
- Deterministic runs and scenario counts can now be set through the MCP interface, matching what the setup wizard offers. A request for a deterministic run is no longer answered with a probabilistic one

## Earlier changes

Weather files
- A file that records its fire weather indices once a day is no longer rejected — Nomad finds the noon reading already in it and offers those as your starting codes
- Uploads now tell you when FWI values are missing, instead of reporting the file as valid

Times and dates
- Ignition time now uses the timezone you chose for the model, not the timezone of the computer you happen to be sitting at
- Daily DMC and DC are calculated from local noon conditions, as CFFDRS intends. Results will differ slightly from earlier runs, and are more accurate

Setup
- Starting a model no longer waits on the browser's notification prompt

## Public demo notes

This is a public demo of Project Nomad — It highlights the latest changes to the application - just remember your data is not persisted - it could be deleted at any time. Reach out with feedback using the link in the about panel.

## Credit

This project is a labor of love for many of us - it could not happen without the deep collaboration that is at work here, between Canadian Agencies, CIFFC and Fire modelling and software development specialists. This Project is part of the CIFFC Stewardship Intiative led by Manny Diaz @ CIFFC.
