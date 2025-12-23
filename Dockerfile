# syntax=docker.io/docker/dockerfile:1

# ============================================
# Stage 1: Build Rust proxy-scraper-checker
# ============================================
FROM docker.io/rust:1-slim-trixie AS rust-builder

WORKDIR /build

# Copy source files for Rust build
COPY src ./src
COPY Cargo.toml Cargo.lock ./

# Build the Rust binary
RUN cargo build --release --locked

# Verify the binary was built
RUN ls -la /build/target/release/ && \
    test -f /build/target/release/proxy-scraper-checker && \
    echo "Binary built successfully!"


# ============================================
# Stage 2: Setup Node.js and build web app
# ============================================
FROM docker.io/node:20-slim AS node-builder

WORKDIR /app/web

COPY web/package.json web/package-lock.json* ./
RUN npm install --production

COPY web/ ./


# ============================================
# Stage 3: Final runtime image (Node.js based)
# ============================================
FROM docker.io/node:20-slim AS final

WORKDIR /app

# Install additional utilities
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Create directories (use existing node user with UID 1000)
RUN mkdir -p /home/node/.cache/proxy_scraper_checker \
  && mkdir -p /app/out \
  && mkdir -p /app/web \
  && chown -R node:node /home/node/.cache/proxy_scraper_checker \
  && chown -R node:node /app

# Copy Rust binary from rust-builder to /usr/local/bin/
COPY --from=rust-builder --chmod=755 /build/target/release/proxy-scraper-checker /usr/local/bin/proxy-scraper-checker

# Verify binary is accessible
RUN ls -la /usr/local/bin/proxy-scraper-checker && \
    /usr/local/bin/proxy-scraper-checker --help || true

# Copy Node.js web application from node-builder
COPY --from=node-builder --chown=node:node /app/web ./web

# Copy config and entrypoint
COPY --chown=node:node config.toml .
COPY --chown=node:node docker-entrypoint.sh .
RUN chmod +x /app/docker-entrypoint.sh

# Environment variables for the web server
ENV RUST_BINARY_PATH=/usr/local/bin/proxy-scraper-checker
ENV OUTPUT_DIR=/app/out
ENV CONFIG_PATH=/app/config.toml
ENV PORT=8080
ENV NODE_ENV=production

# Expose web server port
EXPOSE 8080

USER node

# Use entrypoint script to manage both processes
ENTRYPOINT ["/app/docker-entrypoint.sh"]
