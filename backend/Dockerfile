# Backend Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Production stage
FROM builder AS production
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/index.js"]
