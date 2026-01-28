FROM ubuntu:24.04

# Install runtime dependencies only (no build tools needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgeotiff5 \
    libtiff6 \
    libcurl4t64 \
    libproj25 \
    && rm -rf /var/lib/apt/lists/*

# Create app directory (match path expected by compose/backend)
WORKDIR /appl/firestarr

# Copy pre-built binary and data files
COPY firestarr /appl/firestarr/
COPY fuel.lut /appl/firestarr/
COPY settings.ini /appl/firestarr/
COPY VERSION /appl/firestarr/

# Make binary executable
RUN chmod +x /appl/firestarr/firestarr

# Default entrypoint
ENTRYPOINT ["/appl/firestarr/firestarr"]
