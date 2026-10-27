import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {MAP_BOUNDS, MAP_WIDTH} from './flight-tracking.js';

const WORLD = MAP_WIDTH * 360 / (MAP_BOUNDS.east - MAP_BOUNDS.west);
const NORTH = MAP_BOUNDS.north * Math.PI / 180;
const ORIGIN_X = (MAP_BOUNDS.west + 180) / 360 * WORLD;
const ORIGIN_Y = (1 - Math.log(Math.tan(NORTH) + 1 / Math.cos(NORTH)) / Math.PI) / 2 * WORLD;
const TILE_PIXELS = 512;
const MAX_TILES = 24;
const MAX_REQUESTS = 2;
const MAP_FRAME_MS = 50;
const FRAME_MARGIN = 1.2;
const BLEND_MS = 300;

export function selectMapZoom(ideal, previous) {
  let zoom = previous === null ? Math.round(ideal) : previous;
  // Different entry/exit thresholds prevent toggling at the half-level edge.
  while (ideal > zoom + .68 && zoom < 14) zoom += 1;
  while (ideal < zoom - .68 && zoom > 10) zoom -= 1;
  return Math.max(10, Math.min(14, zoom));
}

function idealZoom(view, pixelsWide) {
  return Math.log(WORLD * pixelsWide / view.width / TILE_PIXELS) / Math.LN2;
}

// The TV can expose a 4K viewport. Keep the backing surface bounded while
// overlays still use full CSS coordinates, so geography and aircraft align.
export function mapSurfaceSize(size, devicePixelRatio) {
  const scale = Math.min(devicePixelRatio || 1, 1.5, 1280 / size.width, 960 / size.height);
  return {width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale))};
}

export function createMapFrame(view, size) {
  const width = view.width * FRAME_MARGIN, height = view.height * FRAME_MARGIN;
  return {view: {x: view.x - (width - view.width) / 2,
    y: view.y - (height - view.height) / 2, width: width, height: height},
  size: {width: size.width * FRAME_MARGIN, height: size.height * FRAME_MARGIN},
  viewport: {width: size.width, height: size.height}};
}

export function mapFrameTransform(frame, view, size) {
  return {x: (frame.view.x - view.x) / view.width * size.width,
    y: (frame.view.y - view.y) / view.height * size.height,
    scaleX: frame.view.width / view.width * size.width / frame.size.width,
    scaleY: frame.view.height / view.height * size.height / frame.size.height};
}

function needsFrame(frame, view, size) {
  if (!frame || frame.viewport.width !== size.width || frame.viewport.height !== size.height) return true;
  const scale = frame.view.width / FRAME_MARGIN / view.width;
  return scale > 1.22 || scale < .9 || view.x < frame.view.x || view.y < frame.view.y ||
    view.x + view.width > frame.view.x + frame.view.width || view.y + view.height > frame.view.y + frame.view.height;
}

export function tileOrigin(x, y, zoom) {
  const size = WORLD / Math.pow(2, zoom);
  return {x: x * size - ORIGIN_X, y: y * size - ORIGIN_Y, size: size};
}

export function visibleMapTiles(view, pixelsWide, fixedZoom) {
  // Request detail only for the visible viewport, never a city-wide archive.
  const ideal = idealZoom(view, pixelsWide);
  const zoom = fixedZoom === undefined ? Math.max(10, Math.min(14, Math.round(ideal))) : fixedZoom;
  const size = WORLD / Math.pow(2, zoom);
  const tiles = [];
  for (let x = Math.floor((view.x + ORIGIN_X) / size); x <= Math.floor((view.x + view.width + ORIGIN_X) / size); x += 1) {
    for (let y = Math.floor((view.y + ORIGIN_Y) / size); y <= Math.floor((view.y + view.height + ORIGIN_Y) / size); y += 1) {
      tiles.push({key: zoom + '/' + x + '/' + y, x: x, y: y, zoom: zoom});
    }
  }
  return tiles;
}

function drawGeometry(ctx, geometry, polygon) {
  ctx.beginPath();
  geometry.forEach(function (ring) {
    ring.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    if (polygon) ctx.closePath();
  });
}

const MAP_PALETTES = {
  classic: {base:'#11191d', landcover:'#19272a', residential:'#131f27', landuse:'#192a30', park:'#172a2c', water:'#153743', waterway:'#164650', aeroway:'#243943', road:'#2f4a59', tertiary:'#45606e', major:'#526f7e', motorway:'#718e9c', rail:'#506068', path:'#414f50', label:'#c0ccc8', secondaryLabel:'#7e9698'},
  noir: {base:'#0b1018', landcover:'#101721', residential:'#121820', landuse:'#111821', park:'#0d151d', water:'#0b141f', waterway:'#17222b', aeroway:'#20252b', road:'#303b44', tertiary:'#46525b', major:'#68737a', motorway:'#929ba0', rail:'#49525a', path:'#2d363d', label:'#707b82', secondaryLabel:'#4f5a63'},
  evangelion: {base:'#080d0d', landcover:'#111e17', residential:'#0d1516', landuse:'#121e19', park:'#102519', water:'#001923', waterway:'#12323b', aeroway:'#273334', road:'#445350', tertiary:'#687370', major:'#9ba7a0', motorway:'#d3d8cb', rail:'#66716c', path:'#394741', label:'#e8e8dc', secondaryLabel:'#9aa9a1'},
  coast: {base:'#f7f5eb', landcover:'#e7eddb', residential:'#f2f0e6', landuse:'#e8eedf', park:'#cfe2c7', water:'#b6dced', waterway:'#96c9dd', aeroway:'#dadfdc', road:'#d2dadd', tertiary:'#beced5', major:'#a4c3d0', motorway:'#88adc0', rail:'#a9b9bf', path:'#c4d0cd', label:'#23395c', secondaryLabel:'#566b7f'},
  lavender: {base:'#eae6fb', landcover:'#e6ebdf', residential:'#eeeaf8', landuse:'#e4eadf', park:'#cbded0', water:'#90bdf3', waterway:'#83a9df', aeroway:'#d3d2e4', road:'#d0cbe1', tertiary:'#beb9d4', major:'#a9accd', motorway:'#96a6cc', rail:'#aaa2be', path:'#c3bcd4', label:'#40204e', secondaryLabel:'#69577b'},
  sage: {base:'#e4ecd9', landcover:'#d0e0ca', residential:'#e0e9d7', landuse:'#cedfc9', park:'#afcfae', water:'#a5cabb', waterway:'#83b5a3', aeroway:'#bfcec1', road:'#c4d3bf', tertiary:'#a9c0aa', major:'#96b29d', motorway:'#83a590', rail:'#9caf9d', path:'#b4cab6', label:'#123f32', secondaryLabel:'#496b59'}
};

function rasterize(bytes, tile, palette) {
  const data = new VectorTile(new Pbf(new Uint8Array(bytes)));
  const image = document.createElement('canvas');
  image.width = TILE_PIXELS; image.height = TILE_PIXELS;
  const ctx = image.getContext('2d');
  ctx.fillStyle = palette.base; ctx.fillRect(0, 0, TILE_PIXELS, TILE_PIXELS);
  const labels = [];
  function layer(name, style) {
    const source = data.layers[name];
    if (!source) return;
    for (let i = 0; i < source.length; i += 1) {
      const feature = source.feature(i);
      const appearance = style(feature.properties, feature.type);
      if (!appearance) continue;
      const scale = TILE_PIXELS / feature.extent;
      ctx.save(); ctx.scale(scale, scale);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      drawGeometry(ctx, feature.loadGeometry(), feature.type === 3);
      if (appearance.fill && feature.type === 3) { ctx.fillStyle = appearance.fill; ctx.fill(); }
      if (appearance.stroke) {
        ctx.strokeStyle = appearance.stroke; ctx.lineWidth = appearance.width / scale;
        if (appearance.dash) ctx.setLineDash(appearance.dash.map(function (v) { return v / scale; }));
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  layer('landcover', function () { return {fill: palette.landcover}; });
  layer('landuse', function (p) { return {fill: p.class === 'residential' ? palette.residential : palette.landuse}; });
  layer('park', function () { return {fill: palette.park}; });
  layer('water', function () { return {fill: palette.water}; });
  layer('waterway', function () { return {stroke: palette.waterway, width: .8}; });
  // Buildings and local place labels compete with the aircraft at TV distance.
  layer('aeroway', function (p, type) {
    return type === 3 ? {fill: palette.aeroway} : {stroke: palette.tertiary, width: p.class === 'runway' ? 3 : .8};
  });
  layer('transportation', function (p) {
    if (p.class === 'rail') return {stroke: palette.rail, width: .6, dash: [2, 2]};
    if (p.class === 'path' || p.class === 'track') return tile.zoom < 14 ? null : {stroke: palette.path, width: .45};
    if (p.class === 'motorway' || p.class === 'trunk') return {stroke: palette.motorway, width: 1.7};
    if (p.class === 'primary' || p.class === 'secondary') return {stroke: palette.major, width: 1.1};
    if (p.class === 'tertiary') return {stroke: palette.tertiary, width: .85};
    return {stroke: palette.road, width: .6};
  });
  const places = data.layers.place;
  const origin = tileOrigin(tile.x, tile.y, tile.zoom);
  if (places) {
    for (let i = 0; i < places.length; i += 1) {
      const feature = places.feature(i);
      const p = feature.properties;
      const name = p['name:latin'] || p.name;
      if (!name || feature.type !== 1 || !/^(city|town)$/.test(p.class)) continue;
      if (tile.zoom < 12 && !/^(city|town)$/.test(p.class)) continue;
      const point = feature.loadGeometry()[0][0];
      labels.push({text: String(name).toLocaleUpperCase('pt-PT'), kind: p.class,
        x: origin.x + point.x / feature.extent * origin.size,
        y: origin.y + point.y / feature.extent * origin.size});
    }
  }
  return {image: image, labels: labels, origin: origin};
}

export function createFlightMap(canvas) {
  const ctx = canvas.getContext('2d', {alpha: false});
  // One bounded snapshot, over the map but below the aircraft/SVG overlays.
  // Opacity animates on the compositor; it does not repaint map tiles per frame.
  const previous = document.createElement('canvas');
  previous.className = 'flight-map-canvas flight-map-previous';
  previous.width = 1; previous.height = 1; previous.style.opacity = '0';
  const previousCtx = previous.getContext('2d', {alpha: false});
  const cache = new Map();
  const pending = new Map();
  let wanted = [];
  let wantedKeys = new Set();
  let baseView = null;
  let baseTiles = [];
  let detailTiles = [];
  let detailZoom = null;
  let paintedZoom = null;
  let previousZoom = null;
  let previousFrame = null;
  let blendStarted = null;
  let lastWidth = null;
  let zoomDirection = 0;
  let template = null;
  let metadataRequest = null;
  let active = false;
  let generation = 0;
  let paintedContent = '';
  let retryMetadataAt = 0;
  let lastRender = -Infinity;
  let lastMaintenance = -Infinity;
  let frame = null;
  let transform = '';
  let redraws = 0;
  let cameraUpdates = 0;
  let palette = MAP_PALETTES.classic;

  function preserve() {
    if (!frame || paintedZoom === null || previousFrame) return;
    previous.width = canvas.width; previous.height = canvas.height;
    previousCtx.drawImage(canvas, 0, 0);
    previousFrame = frame; previousZoom = paintedZoom;
    previous.style.width = frame.size.width + 'px';
    previous.style.height = frame.size.height + 'px';
    previous.style.opacity = '1';
    if (canvas.parentNode) canvas.parentNode.insertBefore(previous, canvas.nextSibling);
  }

  function updatePrevious(view, size, now) {
    if (!previousFrame) return;
    const move = mapFrameTransform(previousFrame, view, size);
    previous.style.transform = 'translate3d(' + move.x.toFixed(3) + 'px,' + move.y.toFixed(3) +
      'px,0) scale(' + move.scaleX.toFixed(6) + ',' + move.scaleY.toFixed(6) + ')';
    if (blendStarted !== null) {
      const progress = Math.min(1, Math.max(0, (now - blendStarted) / BLEND_MS));
      previous.style.opacity = String(1 - progress);
      if (progress === 1) {
        previousFrame = null; previousZoom = null; blendStarted = null;
        previous.width = 1; previous.height = 1;
      }
    }
  }

  function preserveBlend() {
    if (!previousFrame || blendStarted === null) return;
    // If the camera needs a new footprint mid-blend, flatten the exact visible
    // mix into the current surface before taking the next snapshot. This keeps
    // coverage and opacity continuous without allocating a third surface.
    const move = mapFrameTransform(previousFrame, frame.view, frame.size);
    ctx.setTransform(canvas.width / frame.size.width, 0, 0, canvas.height / frame.size.height, 0, 0);
    ctx.globalAlpha = Number(previous.style.opacity);
    ctx.drawImage(previous, move.x, move.y, previousFrame.size.width * move.scaleX,
      previousFrame.size.height * move.scaleY);
    ctx.globalAlpha = 1;
    previousFrame = null; previousZoom = null; blendStarted = null;
  }

  function refreshQueue() {
    const pixels = mapSurfaceSize(frame.size, window.devicePixelRatio);
    const ideal = idealZoom(frame.view, pixels.width);
    if (blendStarted === null) detailZoom = selectMapZoom(ideal, detailZoom);
    baseTiles = visibleMapTiles(baseView, pixels.width, 10);
    detailTiles = visibleMapTiles(frame.view, pixels.width, detailZoom);
    while (baseTiles.length + detailTiles.length > MAX_TILES && detailZoom > 10) {
      detailZoom -= 1;
      detailTiles = visibleMapTiles(frame.view, pixels.width, detailZoom);
    }
    wanted = baseTiles.concat(detailTiles.filter(function (tile) { return tile.zoom !== 10; }));
    wantedKeys = new Set(wanted.map(function (tile) { return tile.key; }));
    // Prefetch the next level near its entry threshold, for the footprint it
    // will have then. Visible tiles always win; spare cache slots bound this.
    const nextZoom = detailZoom + zoomDirection;
    const boundary = detailZoom + zoomDirection * .68;
    if (zoomDirection && nextZoom >= 10 && nextZoom <= 14 && Math.abs(boundary - ideal) < .55) {
      const scale = Math.pow(2, ideal - boundary);
      const view = frame.view;
      const ahead = {x: view.x + view.width * (1 - scale) / 2,
        y: view.y + view.height * (1 - scale) / 2,
        width: view.width * scale, height: view.height * scale};
      const center = {x: ahead.x + ahead.width / 2, y: ahead.y + ahead.height / 2};
      const candidates = visibleMapTiles(ahead, pixels.width, nextZoom).sort(function (a, b) {
        function distance(tile) {
          const p = tileOrigin(tile.x, tile.y, tile.zoom);
          return Math.abs(p.x + p.size / 2 - center.x) + Math.abs(p.y + p.size / 2 - center.y);
        }
        return distance(a) - distance(b);
      });
      candidates.forEach(function (tile) {
        if (wanted.length < MAX_TILES && !wantedKeys.has(tile.key)) {
          wanted.push(tile); wantedKeys.add(tile.key);
        }
      });
    }
  }

  function release(tile) {
    if (tile.image) { tile.image.width = 1; tile.image.height = 1; }
  }

  function remember(tile) {
    cache.set(tile.key, tile);
    while (cache.size > MAX_TILES) {
      // Never evict the base or detail needed by the current frame. Otherwise
      // arrivals can displace one another and leave flashing empty squares.
      const victim = Array.from(cache.values()).filter(function (entry) { return !wantedKeys.has(entry.key); })
        .sort(function (a, b) { return a.used - b.used; })[0];
      if (!victim) break;
      release(victim);
      cache.delete(victim.key);
    }
  }

  function metadata() {
    if (template || metadataRequest || Date.now() < retryMetadataAt) return;
    const controller = new AbortController();
    metadataRequest = controller;
    let timedOut = false;
    const timeout = setTimeout(function () { timedOut = true; controller.abort(); }, 10000);
    fetch('https://tiles.openfreemap.org/planet', {signal: controller.signal}).then(function (response) {
      if (!response.ok) throw new Error('Map source unavailable');
      return response.json();
    }).then(function (data) {
      const candidate = data.tiles && data.tiles[0];
      if (!/^https:\/\/tiles\.openfreemap\.org\/planet\/[a-z0-9_/-]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/i.test(candidate || '')) throw new Error('Invalid map source');
      template = candidate;
    }).catch(function (err) {
      if (timedOut || err.name !== 'AbortError') retryMetadataAt = Date.now() + 30000;
    }).finally(function () {
      clearTimeout(timeout); metadataRequest = null;
    });
  }

  function pump() {
    if (!active || !template) return;
    wanted.forEach(function (tile) {
      if (pending.size >= MAX_REQUESTS || cache.has(tile.key) || pending.has(tile.key)) return;
      const controller = new AbortController();
      const gen = generation;
      pending.set(tile.key, controller);
      const timeout = setTimeout(function () { controller.abort(); }, 12000);
      const tileCount = Math.pow(2, tile.zoom);
      if (tile.y < 0 || tile.y >= tileCount) { pending.delete(tile.key); return; }
      const url = template.replace('{z}', tile.zoom).replace('{x}', ((tile.x % tileCount) + tileCount) % tileCount).replace('{y}', tile.y);
      fetch(url, {signal: controller.signal}).then(function (response) {
        if (!response.ok) throw new Error('Map tile unavailable');
        return response.arrayBuffer();
      }).then(function (bytes) {
        if (!active || gen !== generation) return;
        remember(Object.assign({}, tile, rasterize(bytes, tile, palette), {used: Date.now()}));
      }).catch(function () {
        if (active && gen === generation) remember(Object.assign({}, tile, {retryAt: Date.now() + 30000, used: Date.now()}));
      }).finally(function () {
        clearTimeout(timeout);
        if (pending.get(tile.key) === controller) pending.delete(tile.key);
        pump();
      });
    });
  }

  function visible(tile, view) {
    const p = tile.origin;
    return p && p.x < view.x + view.width && p.x + p.size > view.x &&
      p.y < view.y + view.height && p.y + p.size > view.y;
  }

  return {
    setTheme: function (theme) { palette = MAP_PALETTES[theme] || MAP_PALETTES.classic; },
    resume: function () { active = true; metadata(); },
    pause: function () {
      active = false; generation += 1;
      pending.forEach(function (controller) { controller.abort(); }); pending.clear();
      if (metadataRequest) metadataRequest.abort();
    },
    render: function (view, size) {
      if (!active || !size.width || !size.height) return view;
      const now = Date.now();
      if (lastWidth !== null && Math.abs(lastWidth - view.width) > .001) zoomDirection = view.width < lastWidth ? 1 : -1;
      lastWidth = view.width;
      updatePrevious(view, size, now);
      const reframe = needsFrame(frame, view, size);
      if (reframe) {
        preserveBlend();
        preserve();
        frame = createMapFrame(view, size);
        // A small, persistent coarse base covers gaps while the next zoom's
        // detail downloads. Keep the combined working set within 24 tiles.
        if (!baseView || frame.view.width > baseView.width || frame.view.height > baseView.height) {
          baseView = Object.assign({}, frame.view);
        }
        paintedZoom = null;
        paintedContent = '';
        canvas.style.width = frame.size.width + 'px';
        canvas.style.height = frame.size.height + 'px';
      }
      if (reframe || now - lastMaintenance >= 250) {
        metadata();
        cache.forEach(function (tile, key) { if (tile.retryAt && tile.retryAt < now) cache.delete(key); });
        refreshQueue();
        pump();
        lastMaintenance = now;
      }
      // Reuse the painted surface through small camera changes. Both the map
      // and the aircraft use the current camera, with no delayed overlay view.
      const move = mapFrameTransform(frame, view, size);
      const nextTransform = 'translate3d(' + move.x.toFixed(3) + 'px,' + move.y.toFixed(3) +
        'px,0) scale(' + move.scaleX.toFixed(6) + ',' + move.scaleY.toFixed(6) + ')';
      if (nextTransform !== transform) {
        transform = nextTransform;
        canvas.style.transform = transform;
        cameraUpdates += 1;
        canvas.dataset.cameraUpdates = String(cameraUpdates);
      }
      function ready(tiles) { return tiles.every(function (tile) { const entry = cache.get(tile.key); return entry && entry.image; }); }
      const detailReady = ready(detailTiles);
      const baseReady = ready(baseTiles);
      const content = detailReady ? 'detail:' + detailZoom : baseReady ? 'base' : 'empty';
      canvas.dataset.mapState = previousFrame && blendStarted === null ? 'waiting-detail' :
        blendStarted !== null ? 'blending' : content;
      canvas.dataset.displayZoom = String(previousFrame && blendStarted === null ? previousZoom : paintedZoom || 0);
      canvas.dataset.tileZoom = String(detailZoom);
      canvas.dataset.transitionPixels = String(previous.width * previous.height);
      if (!reframe && (paintedContent === content || now - lastRender < MAP_FRAME_MS)) return view;
      // Do not expose a partially loaded detail level. Retain the previous
      // registered picture until the entire destination frame is available.
      if (detailReady) preserve();
      lastRender = now;
      const drawView = frame.view, drawSize = frame.size;
      const surface = mapSurfaceSize(drawSize, window.devicePixelRatio);
      const width = surface.width, height = surface.height;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      ctx.setTransform(width / drawSize.width, 0, 0, height / drawSize.height, 0, 0);
      ctx.fillStyle = palette.base; ctx.fillRect(0, 0, drawSize.width, drawSize.height);
      const keys = new Set((detailReady ? baseTiles.concat(detailTiles) : baseReady ? baseTiles : [])
        .map(function (tile) { return tile.key; }));
      const entries = Array.from(cache.values()).filter(function (tile) {
        return tile.image && keys.has(tile.key) && visible(tile, drawView);
      })
        .sort(function (a, b) { return a.zoom - b.zoom; });
      entries.forEach(function (tile) {
        tile.used = Date.now();
        const p = tile.origin;
        ctx.drawImage(tile.image, (p.x - drawView.x) / drawView.width * drawSize.width,
          (p.y - drawView.y) / drawView.height * drawSize.height,
          p.size / drawView.width * drawSize.width + .4, p.size / drawView.height * drawSize.height + .4);
      });
      const seen = new Set();
      const boxes = [{x: drawSize.width / 2 - 32, y: drawSize.height / 2 - 25, width: 92, height: 55}];
      (palette === MAP_PALETTES.noir ? [] : entries.slice().reverse()).forEach(function (tile) {
        tile.labels.forEach(function (label) {
          if (seen.has(label.text)) return;
          seen.add(label.text);
          const x = (label.x - drawView.x) / drawView.width * drawSize.width;
          const y = (label.y - drawView.y) / drawView.height * drawSize.height;
          const major = label.kind === 'city';
          const fontSize = major ? Math.max(14, size.width * .023) : Math.max(10, size.width * .013);
          ctx.font = (major ? '600 ' : '400 ') + fontSize + 'px FlightMono,monospace';
          const w = ctx.measureText(label.text).width;
          const box = {x: x - w / 2 - 6, y: y - fontSize, width: w + 12, height: fontSize + 10};
          if (x < 12 || x > drawSize.width - 12 || y < 45 || y > drawSize.height - 35 ||
              boxes.some(function (b) { return box.x < b.x + b.width && box.x + box.width > b.x && box.y < b.y + b.height && box.y + box.height > b.y; })) return;
          boxes.push(box);
          ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = palette.base; ctx.strokeText(label.text, x, y);
          ctx.fillStyle = major ? palette.label : palette.secondaryLabel; ctx.fillText(label.text, x, y);
        });
      });
      canvas.dataset.loadedTiles = String(entries.length);
      paintedZoom = detailReady ? detailZoom : baseReady ? 10 : null;
      if (detailReady && previousFrame && blendStarted === null) blendStarted = now;
      updatePrevious(view, size, now);
      canvas.dataset.mapState = blendStarted !== null ? 'blending' : previousFrame ? 'waiting-detail' : content;
      canvas.dataset.displayZoom = String(previousFrame && blendStarted === null ? previousZoom : paintedZoom || 0);
      canvas.dataset.transitionPixels = String(previous.width * previous.height);
      paintedContent = content;
      redraws += 1;
      canvas.dataset.redraws = String(redraws);
      return view;
    },
    clear: function () {
      cache.forEach(release);
      cache.clear(); wanted = []; wantedKeys.clear(); lastRender = -Infinity; lastMaintenance = -Infinity;
      frame = null; baseView = null; transform = ''; redraws = 0; cameraUpdates = 0;
      baseTiles = []; detailTiles = []; detailZoom = null; paintedZoom = null; previousZoom = null;
      previousFrame = null; blendStarted = null; lastWidth = null; zoomDirection = 0; paintedContent = '';
      previous.width = 1; previous.height = 1; previous.style.opacity = '0'; previous.remove();
      // Hiding a canvas alone retains its pixels. Release them on menu return.
      canvas.width = 1; canvas.height = 1;
      canvas.style.transform = ''; canvas.style.width = ''; canvas.style.height = '';
      delete canvas.dataset.loadedTiles;
      delete canvas.dataset.tileZoom;
      delete canvas.dataset.redraws;
      delete canvas.dataset.cameraUpdates;
      delete canvas.dataset.mapState;
      delete canvas.dataset.displayZoom;
      delete canvas.dataset.transitionPixels;
    }
  };
}
