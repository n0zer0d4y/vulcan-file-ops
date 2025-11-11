FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first
COPY package.json package-lock.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript to JavaScript
RUN npm run build

# Production stage
FROM node:22-alpine AS release

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

# Use the CLI entry point for MCP stdio communication
ENTRYPOINT ["node", "dist/cli.js"]

