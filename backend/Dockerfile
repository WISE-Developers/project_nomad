# Backend Dockerfile
FROM node:22-slim AS builder

WORKDIR /app

# Install GDAL native libraries (required for gdal-async)
# This layer is expensive but rarely changes - cached separately
RUN apt-get update && apt-get install -y \
    gdal-bin \
    libgdal-dev \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy ONLY package manifests first (maximizes layer cache for npm ci)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/

# Install dependencies - this layer survives source code changes
# Only busts when package.json or package-lock.json change
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=@nomad/backend

# Copy backend source (changes here don't bust npm ci cache above)
COPY backend/ ./backend/

# Build backend
RUN npm run build --workspace=@nomad/backend

# Production stage
FROM node:22-slim AS production

# Install GDAL runtime libraries and Docker CLI (for spawning FireSTARR containers)
RUN apt-get update && apt-get install -y \
    gdal-bin \
    libgdal-dev \
    ca-certificates \
    curl \
    gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y docker-ce-cli docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built app and node_modules from workspace structure
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/package.json ./

EXPOSE 3001
CMD ["node", "dist/index.js"]
