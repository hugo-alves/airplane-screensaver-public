#!/usr/bin/env node
// Local-only preview and a narrowly scoped relay for APIs without browser CORS.
// The TV uses its existing Homebrew Channel transport instead of this Mac.
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build/flight-preview');
const portArg = process.argv.indexOf('--port');
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 8894;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
fs.mkdirSync(buildDir, {recursive: true});
function build() {
  esbuild.buildSync({entryPoints: [path.join(root, 'src/js/flight-preview.js')],
    outfile: path.join(buildDir, 'app.js'), bundle: true, target: ['chrome68'], format: 'iife'});
}
build();
const cache = new Map();
function upstream(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {headers: {'User-Agent': 'Airplane-Screensaver/1.0'}}, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('Aircraft provider returned ' + response.statusCode)); return; }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 2_000_000) request.destroy(new Error('Aircraft response too large'));
      });
      response.on('error', reject);
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch (err) { reject(err); } });
    });
    request.setTimeout(8000, () => request.destroy(new Error('Aircraft provider timed out')));
    request.on('error', reject);
  });
}
async function cached(url, ttl) {
  const previous = cache.get(url);
  if (previous && previous.expires > Date.now()) return previous.promise;
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  const promise = upstream(url);
  cache.set(url, {promise, expires: Date.now() + ttl});
  try { return await promise; } catch (err) { cache.delete(url); throw err; }
}
function json(response, status, value) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  response.end(JSON.stringify(value));
}
const types = {'.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain'};
const server = http.createServer(async (request, response) => {
  try {
    if (request.method !== 'GET') { json(response, 405, {error: 'GET only'}); return; }
    const url = new URL(request.url, 'http://127.0.0.1:' + port);
    if (url.pathname === '/api/cities') {
      const query = (url.searchParams.get('q') || '').trim();
      if (query.length < 2 || query.length > 80) { json(response, 400, {error: 'Enter a city name'}); return; }
      const result = await cached('https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&format=json&name=' + encodeURIComponent(query), 3600000);
      json(response, 200, {results: (result.results || []).filter(p => Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 85).map(p => ({name:p.name, country:p.country || '', region:p.admin1 || '', latitude:p.latitude, longitude:p.longitude}))}); return;
    }
    if (url.pathname === '/api/aircraft') {
      const latitude = Number(url.searchParams.get('latitude'));
      const longitude = Number(url.searchParams.get('longitude'));
      const radius = Number(url.searchParams.get('radius'));
      if (!url.searchParams.has('latitude') || !url.searchParams.has('longitude') || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 85 || Math.abs(longitude) > 180 || !Number.isFinite(radius) || radius < 1 || radius > 50) {
        json(response, 400, {error: 'Invalid location or radius'}); return;
      }
      json(response, 200, await cached('https://api.adsb.lol/v2/lat/' + latitude.toFixed(2) +
        '/lon/' + longitude.toFixed(2) + '/dist/' + Math.ceil((radius + 2) / 1.852), 9000)); return;
    }
    if (url.pathname === '/api/aircraft-info') {
      const id = url.searchParams.get('id') || '';
      const callsign = url.searchParams.get('callsign') || '';
      if (!/^[a-f0-9]{6}$/i.test(id) || !/^[a-z0-9]{0,12}$/i.test(callsign)) {
        json(response, 400, {error: 'Invalid aircraft identifier'}); return;
      }
      json(response, 200, await cached('https://api.adsbdb.com/v0/aircraft/' + id +
        (callsign ? '?callsign=' + callsign : ''), 15 * 60 * 1000)); return;
    }
    let file;
    if (url.pathname === '/') file = path.join(root, 'src/flight-preview.html');
    else if (url.pathname === '/app.js') { build(); file = path.join(buildDir, 'app.js'); }
    else if (url.pathname === '/styles/flights.css') file = path.join(root, 'src/styles/flights.css');
    else if (/^\/assets\/flights\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) {
      file = path.join(root, 'assets/flights', path.basename(url.pathname));
    } else { response.writeHead(404); response.end(); return; }
    if (!fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, {'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8'});
    fs.createReadStream(file).pipe(response);
  } catch (err) {
    if (!response.headersSent) json(response, 502, {error: 'Flight data temporarily unavailable'});
    else response.end();
  }
});
server.listen(port, '127.0.0.1', () => console.log('Flight preview: http://127.0.0.1:' + port));
