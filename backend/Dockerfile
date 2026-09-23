# Nomad SAN Dockerfile — single container serving both API and frontend
# In SAN mode, the backend serves the built frontend (same-origin).
# This eliminates the need for a separate frontend container and nginx proxy.

# ---- Stage 1: Build frontend ----
FROM node:22-alpine AS frontend-builder

ARG VITE_MAPBOX_TOKEN
ARG VITE_API_BASE_URL
ARG VITE_AUTH_MODE=simple

ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE

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

# ---- Stage 2b: Production dependencies ----
#
# The runtime tree is installed separately from the build tree (refs #382).
#
# backend-builder legitimately needs devDependencies -- typescript compiles the
# backend -- so its node_modules is not the thing to ship. Copying it wholesale
# put vitest 2.1.9, typescript 5.9.3, eslint 9.39.4 and tar 7.5.13 into the
# runtime image: 850 MB and 448 packages, two of them carrying CRITICAL
# advisories. A scanner then reports every advisory in the dev tree rather than
# what the runtime can actually reach.
FROM node:22-slim AS prod-deps

WORKDIR /app

# gdal-async and better-sqlite3 are native addons. node-pre-gyp fetches a
# prebuild where one matches and falls back to compiling, so the toolchain has
# to be present here as well as in the build stage.
RUN apt-get update && apt-get install -y \
    gdal-bin \
    libgdal-dev \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=@nomad/backend --omit=dev --omit=peer

# --omit=dev is NOT sufficient on its own, and neither is --omit=peer.
#
# vitest is an optional PEER dependency of better-auth. npm resolves peers
# automatically, and `npm ci` installs from the lockfile where the peer is
# already recorded, so both flags are correct and applied and the package
# arrives regardless. Removing it is safe because peerDependenciesMeta marks
# that peer optional -- better-auth runs without it.
#
# Found the hard way in #318, where the first version of the offline bundle
# passed its own tests with vitest sitting inside it.
RUN rm -rf \
    node_modules/vitest \
    node_modules/@vitest \
    node_modules/typescript \
    node_modules/eslint \
    node_modules/@eslint \
    node_modules/@typescript-eslint

# Check the outcome, not the flag. This is the assertion that would have caught
# the original bug; every flag above was individually reasonable.
RUN for p in vitest @vitest typescript eslint; do \
      if [ -e "node_modules/$p" ]; then \
        echo "ERROR: $p is in the production dependency tree"; \
        exit 1; \
      fi; \
    done; \
    echo "production tree carries no test or lint packages"

# The native runtime modules must have SURVIVED the pruning.
#
# This is the failure most likely to go unnoticed: dropping gdal-async or
# better-sqlite3 still produces a smaller image that builds cleanly, and fails
# only when the server starts. Loading them here turns that into a build error.
RUN node -e "require('gdal-async'); require('better-sqlite3'); console.log('gdal-async and better-sqlite3 load in the production tree')"

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

# Ship our own ICU timezone data (refs #364, #365).
#
# Node resolves zones through its BUNDLED ICU, not the OS, so installing
# tzdata here would change nothing. No published Node image carries the
# release that covers NWT/Alberta dropping DST on 2026-11-01 -- node:22-*
# is still on 2026a -- so the data is vendored and ICU is pointed at it.
# process.versions.tz reports the override, and tzdataCurrency.test.ts
# asserts it.
COPY vendor/icu-tzdata/2026c /opt/icu-tzdata
ENV ICU_TIMEZONE_FILES_DIR=/opt/icu-tzdata

# Preserve workspace-relative paths so the backend can find frontend/dist
# Backend code: resolve(__dirname, '../../frontend/dist')
# __dirname = /app/backend/dist → ../../frontend/dist = /app/frontend/dist
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=backend-builder /app/backend/package.json ./backend/

# Copy built frontend into workspace-relative location
COPY --from=frontend-builder /app/dist ./frontend/dist

# Bake the release version into the image.
#
# frontend/package.json is the release source of truth - dev-release.yml reads
# `require('./frontend/package.json').version`, while the root and backend
# package.json files sit at 0.5.0 and are never bumped.
#
# npm_package_version is NOT usable here: it is only set when a process starts
# via npm, and this image runs `node dist/index.js` directly. Relying on it is
# what made /api/v1/info report "1.0.0" from a box running v0.12.1.
COPY --from=frontend-builder /app/package.json /tmp/frontend-package.json
RUN node -p "require('/tmp/frontend-package.json').version" > /app/VERSION \
    && rm /tmp/frontend-package.json \
    && cat /app/VERSION

EXPOSE 3001
WORKDIR /app/backend
CMD ["node", "dist/index.js"]
