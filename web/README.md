# Proxy Scraper Checker - Web Interface

A modern web interface for the proxy-scraper-checker tool built with Node.js, Express, and EJS.

## Features

- 📊 **Dashboard View**: Display proxy results in a responsive table
- 📥 **Download Options**: Download proxy lists in TXT or JSON format
- 🔄 **Real-time Updates**: Trigger proxy checks from the web interface
- 📱 **Responsive Design**: Works on desktop and mobile devices
- 🎨 **Modern UI**: Clean, dark-themed interface with smooth animations

## Prerequisites

- Node.js 18.0.0 or higher
- The Rust `proxy-scraper-checker` binary (built from parent project)

## Installation

```bash
cd web
npm install
```

## Configuration

The web server uses environment variables for configuration:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Web server port |
| `RUST_BINARY_PATH` | `/app/proxy-scraper-checker` | Path to Rust binary |
| `OUTPUT_DIR` | `/app/out` | Directory containing proxy results |
| `CONFIG_PATH` | `/app/config.toml` | Path to config.toml |
| `NODE_ENV` | `production` | Node environment |

## Usage

### Standalone (Development)

```bash
# Set environment variables
export OUTPUT_DIR=../out
export RUST_BINARY_PATH=../target/release/proxy-scraper-checker
export CONFIG_PATH=../config.toml

# Start the server
npm start

# Or with auto-reload
npm run dev
```

### With Docker

```bash
# Build and run with docker-compose
docker compose up --build

# Access the web interface
open http://localhost:8080
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Main dashboard with proxy table |
| `GET` | `/status` | JSON status of proxy data |
| `POST` | `/run` | Trigger proxy checker |
| `GET` | `/download` | Download all proxies (TXT) |
| `GET` | `/download?format=json` | Download all proxies (JSON) |
| `GET` | `/download/:protocol` | Download by protocol (http/socks4/socks5) |
| `GET` | `/api/proxies` | Get proxies as JSON API |
| `GET` | `/api/proxies?protocol=http` | Filter proxies by protocol |

## Project Structure

```
web/
├── server.js           # Express server with routes
├── package.json        # Node.js dependencies
├── views/
│   ├── index.ejs      # Main dashboard template
│   └── error.ejs      # Error page template
└── public/
    └── css/
        └── style.css  # Modern responsive styles
```

## Screenshots

The web interface features:
- Statistics cards showing total, working, and protocol-specific counts
- Sortable proxy table with copy-to-clipboard functionality
- Download dropdown with multiple format options
- Empty state with action button when no data is available

## License

MIT
