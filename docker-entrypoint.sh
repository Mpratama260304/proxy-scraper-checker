#!/bin/bash
set -e

# ============================================
# Docker Entrypoint Script
# Manages Rust proxy-scraper-checker and Node.js web server
# ============================================

echo "============================================"
echo "  Proxy Scraper Checker - Starting Up"
echo "============================================"

# Configuration - check multiple possible locations
find_binary() {
    local paths=(
        "${RUST_BINARY_PATH:-}"
        "/usr/local/bin/proxy-scraper-checker"
        "/app/proxy-scraper-checker"
    )
    
    for path in "${paths[@]}"; do
        if [ -n "$path" ] && [ -f "$path" ] && [ -x "$path" ]; then
            echo "$path"
            return 0
        fi
    done
    
    return 1
}

RUST_BINARY=$(find_binary) || RUST_BINARY="/usr/local/bin/proxy-scraper-checker"
OUTPUT_DIR="${OUTPUT_DIR:-/app/out}"
CONFIG_PATH="${CONFIG_PATH:-/app/config.toml}"
WEB_DIR="/app/web"
RUN_INITIAL_CHECK="${RUN_INITIAL_CHECK:-true}"

echo "[INFO] Rust binary: $RUST_BINARY"
echo "[INFO] Binary exists: $([ -f "$RUST_BINARY" ] && echo 'yes' || echo 'no')"
echo "[INFO] Binary executable: $([ -x "$RUST_BINARY" ] && echo 'yes' || echo 'no')"

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"
echo "[INFO] Output directory: $OUTPUT_DIR"

# Function to run the proxy checker
run_proxy_checker() {
    echo "[INFO] Running proxy scraper and checker..."
    echo "[INFO] Using config: $CONFIG_PATH"
    echo "[INFO] Using binary: $RUST_BINARY"
    
    if [ -f "$RUST_BINARY" ] && [ -x "$RUST_BINARY" ]; then
        cd /app
        "$RUST_BINARY" || {
            echo "[WARN] Proxy checker exited with non-zero status"
        }
        echo "[INFO] Proxy checker completed"
    else
        echo "[ERROR] Rust binary not found or not executable at: $RUST_BINARY"
        echo "[ERROR] Checking possible locations..."
        ls -la /usr/local/bin/proxy-scraper-checker 2>/dev/null || echo "  - Not in /usr/local/bin/"
        ls -la /app/proxy-scraper-checker 2>/dev/null || echo "  - Not in /app/"
    fi
}

# Function to start the web server
start_web_server() {
    echo "[INFO] Starting Node.js web server..."
    cd "$WEB_DIR"
    
    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        echo "[INFO] Installing Node.js dependencies..."
        npm install --production
    fi
    
    echo "[INFO] Web server starting on port ${PORT:-8080}..."
    exec node server.js
}

# Handle different run modes
case "${1:-web}" in
    "check")
        # Run proxy checker only
        run_proxy_checker
        ;;
    "web")
        # Run initial check if enabled, then start web server
        if [ "$RUN_INITIAL_CHECK" = "true" ]; then
            echo "[INFO] Running initial proxy check..."
            run_proxy_checker &
        fi
        start_web_server
        ;;
    "both")
        # Run proxy checker first, then start web server
        run_proxy_checker
        start_web_server
        ;;
    *)
        # Pass through to the command
        exec "$@"
        ;;
esac
