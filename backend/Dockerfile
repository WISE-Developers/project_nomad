# Nomad SAN Dockerfile — single container serving both API and frontend
# In SAN mode, the backend serves the built frontend (same-origin).
# This eliminates the need for a separate frontend container and nginx proxy.

# ---- Stage 1: Build frontend ----
FROM node:22-alpine AS frontend-builder

ARG VITE_MAPBOX_TOKEN
ARG VITE_API_BASE_URL
ARG VITE_SIMPLE_AUTH=true

ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SIMPLE_AUTH=$VITE_SIMPLE_AUTH

WORKDIR /app

COPY frontend/package*.json ./
COPY package-lock.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build

# ---- Stage 2: Build backend ----
FROM node:22-slim AS backend-builder

WORKDIR /app

# Install GDAL native libraries (required for gdal-async)
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
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=@nomad/backend

# Copy backend source (changes here don't bust npm ci cache above)
COPY backend/ ./backend/

# Build backend
RUN npm run build --workspace=@nomad/backend

# ---- Stage 3: Production ----
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

# Preserve workspace-relative paths so the backend can find frontend/dist
# Backend code: resolve(__dirname, '../../frontend/dist')
# __dirname = /app/backend/dist → ../../frontend/dist = /app/frontend/dist
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/backend/package.json ./backend/

# Copy built frontend into workspace-relative location
COPY --from=frontend-builder /app/dist ./frontend/dist

EXPOSE 3001
WORKDIR /app/backend
CMD ["node", "dist/index.js"]
