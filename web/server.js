const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8080;

// Configuration - check multiple possible locations for the binary
const POSSIBLE_BINARY_PATHS = [
    process.env.RUST_BINARY_PATH,
    '/usr/local/bin/proxy-scraper-checker',
    '/app/proxy-scraper-checker',
    path.join(__dirname, '..', 'proxy-scraper-checker'),
    path.join(__dirname, '..', 'target', 'release', 'proxy-scraper-checker')
].filter(Boolean);

// Find the first existing binary path
function findBinaryPath() {
    for (const binaryPath of POSSIBLE_BINARY_PATHS) {
        if (fs.existsSync(binaryPath)) {
            console.log(`[INFO] Found Rust binary at: ${binaryPath}`);
            return binaryPath;
        }
    }
    console.error('[ERROR] Rust binary not found in any of the following locations:');
    POSSIBLE_BINARY_PATHS.forEach(p => console.error(`  - ${p}`));
    return null;
}

const RUST_BINARY_PATH = findBinaryPath() || process.env.RUST_BINARY_PATH || '/usr/local/bin/proxy-scraper-checker';

// Check multiple possible output directories
const POSSIBLE_OUTPUT_DIRS = [
    process.env.OUTPUT_DIR,
    '/app/out',
    '/home/node/.local/share/proxy_scraper_checker',
    './out'
].filter(Boolean);

function findOutputDir() {
    for (const dir of POSSIBLE_OUTPUT_DIRS) {
        const jsonPath = path.join(dir, 'proxies.json');
        const txtPath = path.join(dir, 'proxies', 'all.txt');
        if (fs.existsSync(jsonPath) || fs.existsSync(txtPath)) {
            console.log(`[INFO] Found output directory with data: ${dir}`);
            return dir;
        }
    }
    // Return first existing directory or default
    for (const dir of POSSIBLE_OUTPUT_DIRS) {
        if (fs.existsSync(dir)) {
            return dir;
        }
    }
    return process.env.OUTPUT_DIR || '/app/out';
}

let OUTPUT_DIR = findOutputDir();
const CONFIG_PATH = process.env.CONFIG_PATH || '/app/config.toml';
const CACHE_DIR = process.env.CACHE_DIR || '/home/node/.cache/proxy_scraper_checker';

// Log configuration on startup
console.log('[CONFIG] Rust binary path:', RUST_BINARY_PATH);
console.log('[CONFIG] Output directory:', OUTPUT_DIR);
console.log('[CONFIG] Config path:', CONFIG_PATH);
console.log('[CONFIG] Cache directory:', CACHE_DIR);
console.log('[CONFIG] Binary exists:', fs.existsSync(RUST_BINARY_PATH));

/**
 * Clear cached database files (ASN and geolocation)
 * @returns {Promise<{success: boolean, message: string, filesDeleted: string[]}>}
 */
async function clearCache() {
    const cacheFiles = [
        'asn_database.mmdb',
        'asn_database.mmdb.etag',
        'geolocation_database.mmdb',
        'geolocation_database.mmdb.etag'
    ];
    
    const filesDeleted = [];
    const errors = [];
    
    for (const file of cacheFiles) {
        const filePath = path.join(CACHE_DIR, file);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                filesDeleted.push(file);
                console.log(`[CACHE] Deleted: ${filePath}`);
            }
        } catch (err) {
            errors.push(`Failed to delete ${file}: ${err.message}`);
            console.error(`[ERROR] Failed to delete cache file ${filePath}: ${err.message}`);
        }
    }
    
    return {
        success: errors.length === 0,
        message: errors.length === 0 
            ? `Cleared ${filesDeleted.length} cache files` 
            : `Cleared ${filesDeleted.length} files with ${errors.length} errors`,
        filesDeleted,
        errors
    };
}

// Set up EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files (CSS, JS, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Logger middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url}`);
    next();
});

/**
 * Run the Rust proxy-scraper-checker binary
 * @returns {Promise<{success: boolean, message: string}>}
 */
function runProxyChecker() {
    return new Promise((resolve) => {
        console.log(`[INFO] Starting proxy checker: ${RUST_BINARY_PATH}`);
        
        // Check if the binary exists
        if (!fs.existsSync(RUST_BINARY_PATH)) {
            console.error(`[ERROR] Rust binary not found at: ${RUST_BINARY_PATH}`);
            console.error('[ERROR] Searching for binary in alternate locations...');
            const altPath = findBinaryPath();
            if (!altPath) {
                resolve({ success: false, message: 'Proxy checker binary not found' });
                return;
            }
        }

        const checkerProcess = spawn(RUST_BINARY_PATH, [], {
            cwd: path.dirname(CONFIG_PATH),
            env: {
                ...process.env,
                // Disable TUI for headless operation
                NO_COLOR: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        checkerProcess.stdout.on('data', (data) => {
            stdout += data.toString();
            console.log(`[RUST] ${data.toString().trim()}`);
        });

        checkerProcess.stderr.on('data', (data) => {
            stderr += data.toString();
            console.error(`[RUST ERROR] ${data.toString().trim()}`);
        });

        checkerProcess.on('close', (code) => {
            if (code === 0) {
                console.log('[INFO] Proxy checker completed successfully');
                resolve({ success: true, message: 'Proxy check completed successfully' });
            } else {
                console.error(`[ERROR] Proxy checker exited with code ${code}`);
                resolve({ success: false, message: `Proxy checker failed with exit code ${code}` });
            }
        });

        checkerProcess.on('error', (err) => {
            console.error(`[ERROR] Failed to start proxy checker: ${err.message}`);
            resolve({ success: false, message: `Failed to start proxy checker: ${err.message}` });
        });
    });
}

/**
 * Parse proxy results from JSON file
 * @returns {Array} Array of proxy objects
 */
function getProxyResults() {
    const jsonPath = path.join(OUTPUT_DIR, 'proxies.json');
    const txtDir = path.join(OUTPUT_DIR, 'proxies');
    
    // Try to read JSON file first (more detailed)
    if (fs.existsSync(jsonPath)) {
        try {
            const data = fs.readFileSync(jsonPath, 'utf8');
            const proxies = JSON.parse(data);
            return proxies.map(proxy => ({
                proxy: formatProxyString(proxy),
                protocol: proxy.protocol ? proxy.protocol.toUpperCase() : 'UNKNOWN',
                host: proxy.host,
                port: proxy.port,
                timeout: proxy.timeout ? `${proxy.timeout}s` : 'N/A',
                exitIp: proxy.exit_ip || 'N/A',
                status: proxy.timeout ? 'Working' : 'Unknown',
                asn: proxy.asn?.autonomous_system_organization || 'N/A',
                country: proxy.geolocation?.country?.names?.en || 'N/A'
            }));
        } catch (err) {
            console.error(`[ERROR] Failed to parse JSON: ${err.message}`);
        }
    }
    
    // Fallback: read from text files
    const allTxtPath = path.join(txtDir, 'all.txt');
    if (fs.existsSync(allTxtPath)) {
        try {
            const data = fs.readFileSync(allTxtPath, 'utf8');
            const lines = data.split('\n').filter(line => line.trim());
            return lines.map(line => ({
                proxy: line.trim(),
                protocol: extractProtocol(line),
                host: 'N/A',
                port: 'N/A',
                timeout: 'N/A',
                exitIp: 'N/A',
                status: 'Listed',
                asn: 'N/A',
                country: 'N/A'
            }));
        } catch (err) {
            console.error(`[ERROR] Failed to read txt file: ${err.message}`);
        }
    }
    
    return [];
}

/**
 * Format proxy object to string
 * @param {Object} proxy 
 * @returns {string}
 */
function formatProxyString(proxy) {
    let str = '';
    if (proxy.protocol) {
        str += proxy.protocol.toLowerCase() + '://';
    }
    if (proxy.username && proxy.password) {
        str += `${proxy.username}:${proxy.password}@`;
    }
    str += `${proxy.host}:${proxy.port}`;
    return str;
}

/**
 * Extract protocol from proxy string
 * @param {string} line 
 * @returns {string}
 */
function extractProtocol(line) {
    const match = line.match(/^(https?|socks[45]):/i);
    return match ? match[1].toUpperCase() : 'UNKNOWN';
}

/**
 * Get statistics about proxies
 * @param {Array} proxies 
 * @returns {Object}
 */
function getStats(proxies) {
    const stats = {
        total: proxies.length,
        working: proxies.filter(p => p.status === 'Working').length,
        http: proxies.filter(p => p.protocol === 'HTTP' || p.protocol === 'HTTPS').length,
        socks4: proxies.filter(p => p.protocol === 'SOCKS4').length,
        socks5: proxies.filter(p => p.protocol === 'SOCKS5').length
    };
    return stats;
}

/**
 * Check if output files exist
 * @returns {boolean}
 */
function hasResults() {
    const jsonPath = path.join(OUTPUT_DIR, 'proxies.json');
    const txtDir = path.join(OUTPUT_DIR, 'proxies', 'all.txt');
    return fs.existsSync(jsonPath) || fs.existsSync(txtDir);
}

// Routes

/**
 * GET / - Display proxy results
 */
app.get('/', async (req, res) => {
    try {
        // Refresh output directory to find latest data
        OUTPUT_DIR = findOutputDir();
        console.log(`[INDEX] Using output directory: ${OUTPUT_DIR}`);
        
        const proxies = getProxyResults();
        const stats = getStats(proxies);
        const hasData = proxies.length > 0;
        
        console.log(`[INDEX] Found ${proxies.length} proxies, hasData: ${hasData}`);
        
        res.render('index', {
            proxies,
            stats,
            hasData,
            lastUpdated: hasData ? getLastUpdatedTime() : null,
            error: null
        });
    } catch (err) {
        console.error(`[ERROR] Failed to render index: ${err.message}`);
        res.render('index', {
            proxies: [],
            stats: { total: 0, working: 0, http: 0, socks4: 0, socks5: 0 },
            hasData: false,
            lastUpdated: null,
            error: 'Failed to load proxy results'
        });
    }
});

/**
 * POST /run - Trigger proxy checker (returns immediately with status)
 */
app.post('/run', async (req, res) => {
    try {
        console.log('[INFO] Manual proxy check triggered');
        const result = await runProxyChecker();
        
        // Refresh the output directory after running checker
        OUTPUT_DIR = findOutputDir();
        console.log(`[INFO] Refreshed output directory: ${OUTPUT_DIR}`);
        
        // Get the updated proxy data
        const proxies = getProxyResults();
        const stats = getStats(proxies);
        
        res.json({
            ...result,
            proxies: proxies.slice(0, 100), // Return first 100 proxies
            stats,
            totalProxies: proxies.length
        });
    } catch (err) {
        console.error(`[ERROR] Failed to run proxy checker: ${err.message}`);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /run-stream - Run proxy checker with real-time log streaming via SSE
 * Query params:
 *   - noCache: if 'true', clears cache before running
 */
app.get('/run-stream', async (req, res) => {
    const noCache = req.query.noCache === 'true';
    console.log(`[INFO] Starting proxy checker with real-time streaming (noCache: ${noCache})`);
    
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'status', message: 'Connected to log stream' })}\n\n`);
    
    // Check if binary exists
    if (!fs.existsSync(RUST_BINARY_PATH)) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Proxy checker binary not found' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'complete', success: false })}\n\n`);
        res.end();
        return;
    }
    
    // Clear cache if requested
    if (noCache) {
        res.write(`data: ${JSON.stringify({ type: 'info', message: 'Clearing cached databases...' })}\n\n`);
        const cacheResult = await clearCache();
        res.write(`data: ${JSON.stringify({ type: 'info', message: cacheResult.message })}\n\n`);
        if (cacheResult.filesDeleted.length > 0) {
            cacheResult.filesDeleted.forEach(file => {
                res.write(`data: ${JSON.stringify({ type: 'log', message: `  Deleted: ${file}` })}\n\n`);
            });
        }
        res.write(`data: ${JSON.stringify({ type: 'info', message: 'Fresh databases will be downloaded...' })}\n\n`);
    }
    
    res.write(`data: ${JSON.stringify({ type: 'status', message: 'Starting proxy scraper and checker...' })}\n\n`);
    
    const checkerProcess = spawn(RUST_BINARY_PATH, [], {
        cwd: path.dirname(CONFIG_PATH),
        env: {
            ...process.env,
            NO_COLOR: '1',
            RUST_LOG: 'info'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // Stream stdout
    checkerProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        lines.forEach(line => {
            console.log(`[RUST] ${line}`);
            res.write(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`);
        });
    });
    
    // Stream stderr (Rust logs go to stderr by default with tracing)
    checkerProcess.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        lines.forEach(line => {
            console.log(`[RUST] ${line}`);
            // Parse tracing format logs
            let logType = 'log';
            if (line.includes('ERROR')) logType = 'error';
            else if (line.includes('WARN')) logType = 'warning';
            else if (line.includes('INFO')) logType = 'info';
            res.write(`data: ${JSON.stringify({ type: logType, message: line })}\n\n`);
        });
    });
    
    checkerProcess.on('close', (code) => {
        console.log(`[INFO] Proxy checker process exited with code ${code}`);
        
        // Refresh output directory
        OUTPUT_DIR = findOutputDir();
        const proxies = getProxyResults();
        const stats = getStats(proxies);
        
        res.write(`data: ${JSON.stringify({ 
            type: 'complete', 
            success: code === 0,
            message: code === 0 ? 'Proxy check completed successfully!' : `Process exited with code ${code}`,
            stats,
            totalProxies: proxies.length
        })}\n\n`);
        res.end();
    });
    
    checkerProcess.on('error', (err) => {
        console.error(`[ERROR] Failed to start proxy checker: ${err.message}`);
        res.write(`data: ${JSON.stringify({ type: 'error', message: `Failed to start: ${err.message}` })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'complete', success: false })}\n\n`);
        res.end();
    });
    
    // Handle client disconnect
    req.on('close', () => {
        console.log('[INFO] Client disconnected from log stream');
        checkerProcess.kill('SIGTERM');
    });
});

/**
 * POST /clear-cache - Clear cached database files
 */
app.post('/clear-cache', async (req, res) => {
    console.log('[INFO] Clearing cache files');
    const result = await clearCache();
    res.json(result);
});

/**
 * GET /cache-status - Get cache status
 */
app.get('/cache-status', (req, res) => {
    const cacheFiles = [
        'asn_database.mmdb',
        'geolocation_database.mmdb'
    ];
    
    const status = cacheFiles.map(file => {
        const filePath = path.join(CACHE_DIR, file);
        const exists = fs.existsSync(filePath);
        let size = 0;
        let modified = null;
        
        if (exists) {
            const stats = fs.statSync(filePath);
            size = stats.size;
            modified = stats.mtime;
        }
        
        return { file, exists, size, modified };
    });
    
    const totalSize = status.reduce((sum, f) => sum + f.size, 0);
    const hasCachedData = status.some(f => f.exists);
    
    res.json({
        hasCachedData,
        totalSize,
        totalSizeFormatted: formatBytes(totalSize),
        files: status,
        cacheDir: CACHE_DIR
    });
});

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * GET /status - Get current status
 */
app.get('/status', (req, res) => {
    // Refresh output directory to find latest data
    OUTPUT_DIR = findOutputDir();
    
    const hasData = hasResults();
    const proxies = hasData ? getProxyResults() : [];
    const stats = getStats(proxies);
    
    console.log(`[STATUS] Output dir: ${OUTPUT_DIR}, hasData: ${hasData}, proxies: ${proxies.length}`);
    
    res.json({
        hasData,
        stats,
        lastUpdated: hasData ? getLastUpdatedTime() : null,
        outputDir: OUTPUT_DIR
    });
});

/**
 * GET /download - Download all proxies as txt
 */
app.get('/download', (req, res) => {
    const format = req.query.format || 'txt';
    
    if (format === 'json') {
        const jsonPath = path.join(OUTPUT_DIR, 'proxies.json');
        if (fs.existsSync(jsonPath)) {
            res.download(jsonPath, 'proxies.json', (err) => {
                if (err) {
                    console.error(`[ERROR] Download failed: ${err.message}`);
                    res.status(500).send('Download failed');
                }
            });
        } else {
            res.status(404).send('No proxy results available for download');
        }
    } else {
        const txtPath = path.join(OUTPUT_DIR, 'proxies', 'all.txt');
        if (fs.existsSync(txtPath)) {
            res.download(txtPath, 'proxies.txt', (err) => {
                if (err) {
                    console.error(`[ERROR] Download failed: ${err.message}`);
                    res.status(500).send('Download failed');
                }
            });
        } else {
            res.status(404).send('No proxy results available for download');
        }
    }
});

/**
 * GET /download/:protocol - Download proxies by protocol
 */
app.get('/download/:protocol', (req, res) => {
    const protocol = req.params.protocol.toLowerCase();
    const validProtocols = ['http', 'socks4', 'socks5', 'all'];
    
    if (!validProtocols.includes(protocol)) {
        return res.status(400).send('Invalid protocol');
    }
    
    const filename = `${protocol}.txt`;
    const filePath = path.join(OUTPUT_DIR, 'proxies', filename);
    
    if (fs.existsSync(filePath)) {
        res.download(filePath, filename, (err) => {
            if (err) {
                console.error(`[ERROR] Download failed: ${err.message}`);
                res.status(500).send('Download failed');
            }
        });
    } else {
        res.status(404).send(`No ${protocol.toUpperCase()} proxies available`);
    }
});

/**
 * GET /api/proxies - Get proxies as JSON API
 */
app.get('/api/proxies', (req, res) => {
    try {
        const proxies = getProxyResults();
        const protocol = req.query.protocol;
        
        let filtered = proxies;
        if (protocol) {
            filtered = proxies.filter(p => 
                p.protocol.toLowerCase() === protocol.toLowerCase()
            );
        }
        
        res.json({
            success: true,
            count: filtered.length,
            proxies: filtered
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Get last updated time of proxy results
 * @returns {string|null}
 */
function getLastUpdatedTime() {
    const jsonPath = path.join(OUTPUT_DIR, 'proxies.json');
    const txtPath = path.join(OUTPUT_DIR, 'proxies', 'all.txt');
    
    try {
        let stat;
        if (fs.existsSync(jsonPath)) {
            stat = fs.statSync(jsonPath);
        } else if (fs.existsSync(txtPath)) {
            stat = fs.statSync(txtPath);
        } else {
            return null;
        }
        return stat.mtime.toISOString();
    } catch {
        return null;
    }
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(`[ERROR] ${err.stack}`);
    res.status(500).render('error', { 
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', { 
        message: 'Page not found',
        error: {}
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║       Proxy Scraper Checker - Web Interface               ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at: http://0.0.0.0:${PORT.toString().padEnd(23)}║
║  Output directory:  ${OUTPUT_DIR.padEnd(36)}║
╚═══════════════════════════════════════════════════════════╝
    `);
    
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`[INFO] Created output directory: ${OUTPUT_DIR}`);
    }
});
