# Using FireSTARR image in a container:

## the docker-compose.yaml

```yaml
services:
  firestarr-app:
    # Image is set via FIRESTARR_IMAGE in .env — do not hardcode the tag here.
    # Example: FIRESTARR_IMAGE=ghcr.io/cwfmf/firestarr:dev-0.9.5.4
    image: ${FIRESTARR_IMAGE:?FIRESTARR_IMAGE must be set in .env}
    profiles: ["modeling"]
    volumes:
      - /etc/ssl/certs:/etc/ssl/certs
      - ${FIRESTARR_DATASET_PATH}:/appl/data
      - ${FIRESTARR_DATASET_PATH}/sims:/appl/data/sims
    env_file:
      - .env
```

## Sample Data Layout

```txt

.
├── 10N_50651
│   ├── 10N_50651.tif
│   └── firestarr_10N_50651_wx.csv
├── generated
│   ├── bounds
│   │   ├── bounds_ON.cpg
│   │   ├── bounds_ON.dbf
│   │   ├── bounds_ON.gpkg
│   │   ├── bounds_ON.prj
│   │   ├── bounds_ON.shp
│   │   ├── bounds_ON.shx
│   │   ├── canada.cpg
│   │   ├── canada.dbf
│   │   ├── canada.gpkg
│   │   ├── canada.prj
│   │   ├── canada.shp
│   │   └── canada.shx
│   └── grid
│       └── 100m
│           └── default
│               ├── dem_10_0.tif
│               ├── dem_10_5.tif
│               ├── dem_11_0.tif
│               ├── dem_11_5.tif
│               ├── dem_12_0.tif
│               ├── dem_12_5.tif
│               ├── dem_13_0.tif
│               ├── dem_13_5.tif
│               ├── dem_14_0.tif
│               ├── dem_14_5.tif
│               ├── dem_15_0.tif
│               ├── dem_15_5.tif
│               ├── dem_16_0.tif
│               ├── dem_16_5.tif
│               ├── dem_17_0.tif
│               ├── dem_17_5.tif
│               ├── dem_18_0.tif
│               ├── dem_18_5.tif
│               ├── dem_19_0.tif
│               ├── dem_19_5.tif
│               ├── dem_20_0.tif
│               ├── dem_20_5.tif
│               ├── dem_21_0.tif
│               ├── dem_21_5.tif
│               ├── dem_22_0.tif
│               ├── dem_7_0.tif
│               ├── dem_7_5.tif
│               ├── dem_8_0.tif
│               ├── dem_8_5.tif
│               ├── dem_9_0.tif
│               ├── dem_9_5.tif
│               ├── fuel_10_0.tif
│               ├── fuel_10_5.tif
│               ├── fuel_11_0.tif
│               ├── fuel_11_5.tif
│               ├── fuel_12_0.tif
│               ├── fuel_12_5.tif
│               ├── fuel_13_0.tif
│               ├── fuel_13_5.tif
│               ├── fuel_14_0.tif
│               ├── fuel_14_5.tif
│               ├── fuel_15_0.tif
│               ├── fuel_15_5.tif
│               ├── fuel_16_0.tif
│               ├── fuel_16_5.tif
│               ├── fuel_17_0.tif
│               ├── fuel_17_5.tif
│               ├── fuel_18_0.tif
│               ├── fuel_18_5.tif
│               ├── fuel_19_0.tif
│               ├── fuel_19_5.tif
│               ├── fuel_20_0.tif
│               ├── fuel_20_5.tif
│               ├── fuel_21_0.tif
│               ├── fuel_21_5.tif
│               ├── fuel_22_0.tif
│               ├── fuel_7_0.tif
│               ├── fuel_7_5.tif
│               ├── fuel_8_0.tif
│               ├── fuel_8_5.tif
│               ├── fuel_9_0.tif
│               └── fuel_9_5.tif
├── grids
└── sims
```



## Binary usage

```text
Usage: /appl/firestarr/firestarr <output_dir> <yyyy-mm-dd> <lat> <lon> <HH:MM> [options]

Run simulations and save output in the specified directory


Usage: /appl/firestarr/firestarr surface <output_dir> <yyyy-mm-dd> <lat> <lon> <HH:MM> [options]

Calculate probability surface and save output in the specified directory


Usage: /appl/firestarr/firestarr test <output_dir> [options]

 Run test cases and save output in the specified directory

 Input Options
   -h                        Show help
   -v                        Increase output level
   -q                        Decrease output level
   --no-probability          Do not output probability grids
   --raster-root             Use specified directory as raster root
   --fuel-lut                Use specified fuel lookup table
   --log                     Output log file
   --wx                      Input weather file
   --confidence              Use specified confidence level
   --perim                   Start from perimeter
   --size                    Start from size
   --ffmc                    Startup Fine Fuel Moisture Code
   --dmc                     Startup Duff Moisture Code
   --dc                      Startup Drought Code
   --apcp_prev               Startup precipitation between 1200 yesterday and start of hourly weather
   --output_date_offsets     Override output date offsets
   ```

## simple tests

### firestar usage

```txt
docker compose run --rm firestarr-app /appl/firestarr/firestarr -h
```

### firestar test usage

```txt
docker compose run --rm firestarr-app /appl/firestarr/firestarr test -h
```

gives:

```txt
Usage: /appl/firestarr/firestarr <output_dir> <yyyy-mm-dd> <lat> <lon> <HH:MM> [options]

Run simulations and save output in the specified directory


Usage: /appl/firestarr/firestarr surface <output_dir> <yyyy-mm-dd> <lat> <lon> <HH:MM> [options]

Calculate probability surface and save output in the specified directory


Usage: /appl/firestarr/firestarr test <output_dir> [options]

 Run test cases and save output in the specified directory

 Input Options
   -h                        Show help
   -v                        Increase output level
   -q                        Decrease output level
   --hours                   Duration in hours
   --fuel                    FBP fuel type
   --ffmc                    Constant Fine Fuel Moisture Code
   --dmc                     Constant Duff Moisture Code
   --dc                      Constant Drought Code
   --wd                      Constant wind direction
   --ws                      Constant wind speed
   --slope                   Constant slope
   --aspect                  Constant slope aspect/azimuth
```



### 1 hour C2 test

```txt
docker compose run --rm firestarr-app /appl/firestarr/firestarr test /appl/data/outputs/smallTest --hours 1
```

### big test

```txt
docker compose run --rm firestarr-app /appl/firestarr/firestarr /appl/data/outputs/bigTest 2024-06-03 58.81228184403946 -122.9117103995713 01:00 --ffmc 89.9 --dmc 59.5 --dc 450.9 --apcp_prev 0 -v --wx /appl/data/10N_50651/firestarr_10N_50651_wx.csv --output_date_offsets [1]  --perim /appl/data/10N_50651/10N_50651.tif
```
