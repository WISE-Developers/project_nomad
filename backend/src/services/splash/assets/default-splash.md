---
title: Welcome to
---

![Nomad](/nomad-logo.png)

## What's new

Weather files
- A file that records its fire weather indices once a day is no longer rejected — Nomad finds the noon reading already in it and offers those as your starting codes
- Uploads now tell you when FWI values are missing, instead of reporting the file as valid
- Weather problems are explained before a model starts, naming the day and what to change, rather than failing part-way through with an exit code

Times and dates
- Ignition time now uses the timezone you chose for the model, not the timezone of the computer you happen to be sitting at
- Daily DMC and DC are calculated from local noon conditions, as CFFDRS intends. Results will differ slightly from earlier runs, and are more accurate

Results and setup
- A missing fuel dataset now names the year it needs and lists the years installed
- Results record the fuel vintage a model actually used, so installing a dataset later never changes what a past run reports
- Starting a model no longer waits on the browser's notification prompt

## Public demo notes

This is a public demo of Project Nomad — It highlights the latest changes to the application - just remember your data is not persisted - it could be deleted at any time. Reach out with feedback using the link in the about panel.

## Credit

This project is a labor of love for many of us - it could not happen without the deep collaboration that is at work here, between Canadian Agencies, CIFFC and Fire modelling and software development specialists. This Project is part of the CIFFC Stewardship Intiative led by Manny Diaz @ CIFFC.
