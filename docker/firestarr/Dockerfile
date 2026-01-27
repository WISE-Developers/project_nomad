FROM ubuntu:24.04

# Install runtime dependencies only (no build tools needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgeotiff5 \
    libtiff6 \
    libcurl4t64 \
    libproj25 \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy pre-built binary and data files
COPY firestarr /app/
COPY fuel.lut /app/
COPY settings.ini /app/
COPY VERSION /app/

# Make binary executable
RUN chmod +x /app/firestarr

# Default entrypoint
ENTRYPOINT ["/app/firestarr"]
