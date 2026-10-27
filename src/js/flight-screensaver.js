import {t, locale, distance, altitude, speed} from './preferences.js';
import {resolveAircraftIcon} from './flight-aircraft-icons.js';
import {createFlightClient, readAircraftMetadata} from './flight-data.js';
import {createFlightTracker, readAircraftFeed, normalizeFlightConfig, projectFlight,
  zoneRadiusPixels, distanceKm, selectAircraft, altitudeDisposition, MAP_WIDTH, MAP_HEIGHT} from './flight-tracking.js';
import {resolveAppUrl} from './compat.js';
import {createFlightMap} from './flight-map.js';
import {createFlightCamera, cameraPoint, aircraftMarkerScale, projectFlightNear} from './flight-camera.js';

function text(element, value) { if (element.textContent !== value) element.textContent = value; }
function routeText(element, value) {
  if (element.textContent === value) return;
  const parts = value.split(' → ');
  if (parts.length !== 2) { element.textContent = value; return; }
  element.textContent = '';
  element.appendChild(document.createTextNode(parts[0] + ' '));
  const arrow = document.createElement('span');
  arrow.className = 'flight-route-arrow'; arrow.textContent = '→';
  element.appendChild(arrow);
  element.appendChild(document.createTextNode(' ' + parts[1]));
}

export function createFlightScreensaver(options) {
  const root = options.rootEl;
  const getConfig = options.getConfig;
  const client = options.client || createFlightClient();
  const tracker = createFlightTracker();
  const screen = document.createElement('section');
  screen.className = 'flight-screen';
  screen.hidden = true;
  screen.setAttribute('aria-label', 'Aviões nas proximidades');
  screen.innerHTML = '<header class="flight-header"><h1>AVIÃO NAS PROXIMIDADES</h1><span class="flight-japanese" lang="ja">くたばれ、クソ野郎</span><time class="flight-clock"></time></header>' +
    '<div class="flight-eva-brand" aria-hidden="true">NERV</div><div class="flight-eva-rail" aria-hidden="true"><span>01<br>MAPA</span><span>02<br>REGIÃO</span><span>03<br>RASTREIO</span></div>' +
    '<div class="flight-layout"><div class="flight-map">' +
      '<canvas class="flight-map-canvas" aria-label="Mapa da zona de observação"></canvas>' +
      '<svg class="flight-map-geometry" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
        '<g class="flight-trails"></g><circle class="flight-zone"></circle>' +
      '</svg><div class="flight-markers"></div>' +
      '<div class="flight-home-marker"><span>REFERÊNCIA</span></div>' +
      '<div class="flight-map-status"><span class="flight-phase">À ESCUTA</span><span class="flight-scale"></span></div><span class="flight-sage-phase" hidden></span>' +
      '<div class="flight-map-caption"><span>© OpenStreetMap · OpenFreeMap</span><span class="flight-location" hidden></span><span class="flight-count"></span></div>' +
    '</div><aside class="flight-information">' +
      '<div class="flight-detail-phase">À ESCUTA</div><div class="flight-ident-label flight-eva-label">VOO</div><div class="flight-code">À ESCUTA</div>' +
      '<div class="flight-route-label flight-eva-label">ORIGEM → DESTINO</div><div class="flight-route">A procurar aeronaves</div>' +
      '<div class="flight-route-note"></div><div class="flight-airline-label flight-eva-label">COMPANHIA AÉREA</div><div class="flight-aircraft"><div class="flight-airline">TRÁFEGO AÉREO</div><div class="flight-model">TRÁFEGO</div></div>' +
      '<div class="flight-reading"><span>DISTÂNCIA</span><strong class="flight-distance">—</strong></div>' +
      '<div class="flight-reading"><span>ALTITUDE BAROMÉTRICA</span><strong class="flight-altitude">—</strong><small class="flight-altitude-note"></small></div>' +
      '<div class="flight-secondary"><span class="flight-speed">—</span><span class="flight-age">A ligar à fonte</span></div>' +
      '<footer class="flight-footer"><div class="flight-connection">A RECEBER DADOS</div>' +
        '<div>Posição estimada entre observações</div>' +
        '<div class="flight-credits"><a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · ' +
        '<a href="https://www.openmaptiles.org" target="_blank" rel="noreferrer">© OpenMapTiles</a></div>' +
        '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></footer>' +
    '</aside></div>';
  const noirCredits = document.createElement('div');
  noirCredits.className = 'flight-noir-attribution';
  noirCredits.innerHTML = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · <a href="https://www.openmaptiles.org" target="_blank" rel="noreferrer">© OpenMapTiles</a> · <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · ADSB.lol · ADSBdb';
  screen.appendChild(noirCredits);
  const outerScale = document.createElement('span');
  outerScale.className = 'flight-scale-outside';
  screen.querySelector('.flight-layout').appendChild(outerScale);
  const headerAircraft = document.createElement('img');
  headerAircraft.className = 'flight-header-aircraft';
  headerAircraft.alt = '';
  headerAircraft.src = resolveAppUrl('assets/flights/aircraft.png');
  screen.querySelector('.flight-header').insertBefore(headerAircraft, screen.querySelector('.flight-header h1'));
  const warning = document.createElement('img');
  warning.className = 'flight-warning';
  warning.alt = '';
  warning.src = resolveAppUrl('assets/flights/warning-stripes.png');
  screen.appendChild(warning);
  root.appendChild(screen);
  const el = {};
  ['map', 'markers', 'code', 'route', 'airline', 'model', 'distance', 'altitude',
    'clock', 'route-note', 'altitude-note', 'speed', 'age', 'connection', 'location', 'count', 'trails', 'zone', 'phase', 'detail-phase', 'scale'].forEach(function (key) {
    el[key] = screen.querySelector('.flight-' + key);
  });
  const homeMarker = screen.querySelector('.flight-home-marker');
  const sagePhase = screen.querySelector('.flight-sage-phase');
  const svg = screen.querySelector('svg');
  text(screen.querySelector('.flight-home-marker span'), options.homeLabel || 'REFERÊNCIA');
  svg.setAttribute('viewBox', '0 0 ' + MAP_WIDTH + ' ' + MAP_HEIGHT);
  svg.setAttribute('preserveAspectRatio', 'none');
  const map = createFlightMap(screen.querySelector('.flight-map-canvas'));
  let active = false;
  let running = false;
  let generation = 0;
  let timer = null;
  let frame = null;
  let lastFrame = 0;
  let frameInterval = 32;
  let lastLabels = 0;
  let selectedId = null;
  let failures = 0;
  let lastSuccess = 0;
  let mapSize = {width: 0, height: 0};
  let currentConfig = null;
  let camera = null;
  let view = null;
  const markers = new Map();
  const trailElements = new Map();
  let liveConnector = null;
  let lastTrailStyle = 0;
  const metadata = new Map();
  const observer = new MutationObserver(syncVisibility);
  function tr(value) { return t(value, config().language); }
  function config() { return currentConfig || normalizeFlightConfig(getConfig().flights); }

  function resize() {
    frameInterval = 32;
    mapSize = {width: el.map.clientWidth, height: el.map.clientHeight};
    screen.style.setProperty('--flight-vw', screen.clientWidth / 100 + 'px');
    screen.style.setProperty('--flight-vh', screen.clientHeight / 100 + 'px');
  }
  function paintZone() {
    const cfg = config();
    screen.setAttribute('aria-label', tr('Aviões nas proximidades'));
    screen.querySelector('h1').textContent = ['coast','lavender','sage'].indexOf(cfg.theme) >= 0 ? (cfg.language === 'en' ? 'Aircraft nearby' : 'Avião nas proximidades') : tr('AVIÃO NAS PROXIMIDADES');
    screen.querySelector('.flight-ident-label').textContent = cfg.language === 'en' ? 'FLIGHT' : 'VOO';
    screen.querySelector('.flight-route-label').textContent = cfg.language === 'en' ? 'ORIGIN → DESTINATION' : 'ORIGEM → DESTINO';
    screen.querySelector('.flight-airline-label').textContent = cfg.language === 'en' ? 'AIRLINE' : 'COMPANHIA AÉREA';
    screen.querySelector('canvas').setAttribute('aria-label', tr('Mapa da zona de observação'));
    screen.querySelector('.flight-home-marker span').textContent = tr('REFERÊNCIA');
    const readings = screen.querySelectorAll('.flight-reading span');
    readings[0].textContent = tr('DISTÂNCIA'); readings[1].textContent = tr('ALTITUDE BAROMÉTRICA');
    screen.querySelector('.flight-footer > div:nth-child(2)').textContent = tr('Posição estimada entre observações');
    const point = projectFlight(cfg.location);
    const radius = zoneRadiusPixels(cfg.radiusKm, cfg.location.latitude);
    el.zone.setAttribute('cx', point.x);
    el.zone.setAttribute('cy', point.y);
    el.zone.setAttribute('r', radius);
    text(el.location, cfg.location.name.toLocaleUpperCase('pt-PT'));
  }

  function requestMetadata(aircraft, now, gen) {
    if (!aircraft || aircraft.id.charAt(0) === '~') return;
    const key = aircraft.id + ':' + aircraft.callsign;
    if (metadata.has(key) && metadata.get(key).expires > now) return;
    if (metadata.size >= 64) metadata.delete(metadata.keys().next().value);
    // Record in-flight and negative lookups too; the same absent route is not
    // requested every frame. No route data is persisted in a database or files.
    metadata.set(key, {value: {}, expires: now + 5 * 60 * 1000});
    client.metadata(aircraft).then(function (data) {
      if (!running || gen !== generation) return;
      metadata.set(key, {value: readAircraftMetadata(data), expires: Date.now() + 15 * 60 * 1000});
      lastLabels = 0;
    }).catch(function () { /* Unknown routes stay unknown; position tracking continues. */ });
  }

  async function poll() {
    const gen = generation;
    try {
      const payload = await client.nearby(config());
      if (!running || gen !== generation) return;
      const now = Date.now();
      tracker.ingest(readAircraftFeed(payload, now), now);
      failures = 0;
      frameInterval = 32;
      lastSuccess = now;
      const selected = selectAircraft(tracker.positions(now).filter(function(p) { return distanceKm(config().location, p) <= config().radiusKm; }), config().location, selectedId);
      if (selected) requestMetadata(selected, now, gen);
      lastLabels = 0;
    } catch (err) {
      if (!running || gen !== generation) return;
      failures += 1;
      lastLabels = 0;
    } finally {
      if (running && gen === generation) {
        timer = setTimeout(poll, failures ? Math.min(60000, 10000 * Math.pow(2, failures)) : 10000);
      }
    }
  }

  function updateLabels(positions, selected, now) {
    text(el.clock, options.previewTime || new Date(now).toLocaleTimeString(locale(config().language), {hour: '2-digit', minute: '2-digit'}));
    text(el.count, positions.length + (positions.length === 1 ? ' AERONAVE' : ' AERONAVES'));
    text(el.connection, options.simulated ? tr('DADOS SIMULADOS') : options.replay ? 'REPETIÇÃO · VOO REAL' : failures ? tr('A TENTAR RESTABELECER LIGAÇÃO') : lastSuccess ? tr('SINAL RECEBIDO') : tr('A RECEBER DADOS'));
    screen.classList.toggle('is-offline', !!failures);
    if (!selected) {
      text(el.code, tr('À ESCUTA'));
      if (options.replay && options.replay.done()) text(el.code, 'FIM');
      el.code.classList.add('is-long');
      el.code.style.setProperty('--flight-code-size', '6.1');
      routeText(el.route, failures ? tr('Fonte temporariamente indisponível') : lastSuccess ? tr('Sem passagens próximas') : tr('A procurar aeronaves'));
      if (options.replay && options.replay.done()) text(el.route, 'Repetição terminada');
      text(el['route-note'], '');
      el.route.classList.toggle('is-long', el.route.textContent.length > 22);
      el.airline.classList.remove('is-long');
      text(el.airline, tr('TRÁFEGO AÉREO'));
      text(el.model, config().location.name.toLocaleUpperCase('pt-PT'));
      text(el.distance, '—'); text(el.altitude, '—'); text(el['altitude-note'], ''); text(el.speed, '');
      text(el.age, lastSuccess ? (config().language === 'en' ? 'Last connection ' : 'Última ligação há ') + Math.floor((now - lastSuccess) / 1000) + (config().language === 'en' ? ' s ago' : ' s') : tr('A ligar à fonte'));
      return;
    }
    const extra = (metadata.get(selected.id + ':' + selected.callsign) || {}).value || {};
    const friendly = ['coast','lavender','sage'].indexOf(config().theme) >= 0;
    const display = function(value) { return friendly ? value : value.toLocaleUpperCase('pt-PT'); };
    text(el.code, extra.callsign || selected.callsign || selected.registration || selected.id.toUpperCase());
    el.code.classList.toggle('is-long', el.code.textContent.length > 7);
    el.code.style.setProperty('--flight-code-size', String(Math.min(6.1, 48 / el.code.textContent.length)));
    routeText(el.route, extra.origin && extra.destination
      ? display(extra.origin) + ' → ' + display(extra.destination)
      : tr('ROTA NÃO DISPONÍVEL'));
    el.route.classList.toggle('is-long', el.route.textContent.length > 22);
    text(el['route-note'], options.simulated ? tr('Rota simulada') : extra.origin && extra.destination ? tr('Rota publicada · ADSBdb') : tr('Rota não publicada pela fonte'));
    text(el.airline, display(extra.airline || tr('IDENTIFICAÇÃO DA AERONAVE')));
    el.airline.classList.toggle('is-long', el.airline.textContent.length > 22);
    text(el.model, display(extra.model || selected.model || extra.registration || selected.registration || tr('Modelo não disponível')));
    text(el.distance, distance(distanceKm(config().location, selected), config().units, config().language));
    const altitudeState = altitudeDisposition(selected.altitudeM);
    text(el.altitude, altitudeState === 'valid' ? altitude(selected.altitudeM, config().units, config().language) : '—');
    text(el['altitude-note'], altitudeState === 'below-zero' ? tr('Leitura barométrica abaixo de zero') : '');
    text(el.speed, selected.speedKmh === null ? '' : speed(selected.speedKmh, config().units, config().language));
    text(el.age, options.simulated ? tr('DADOS SIMULADOS') : options.replay ? 'Trajeto gravado · posição interpolada' : (config().language === 'en' ? 'ADSB.lol · ' : 'ADSB.lol · há ') + Math.floor(selected.ageSeconds) + (config().language === 'en' ? ' s ago' : ' s'));
  }

  function render(timestamp) {
    if (!running) return;
    frame = requestAnimationFrame(render);
    if (timestamp - lastFrame < frameInterval) return;
    lastFrame = timestamp;
    const now = Date.now();
    if (options.replay && options.replay.done()) tracker.clear();
    const positions = tracker.positions(now).filter(function (p) {
      if (distanceKm(config().location, p) > config().radiusKm) return false;
      const point = projectFlight(p);
      return point.x > -50 && point.x < MAP_WIDTH + 50 && point.y > -50 && point.y < MAP_HEIGHT + 50;
    }).slice(0, 40);
    const selected = selectAircraft(positions, config().location, selectedId);
    let nextView = camera.update(selected, mapSize, now);
    // The circular viewport has less usable area at its corners. Widen the
    // geographic view so both the reference and the aircraft remain visible.
    if (config().theme === 'lavender') {
      const factor = 1.2;
      const width = nextView.width * factor, height = nextView.height * factor;
      nextView = Object.assign({}, nextView, {x: nextView.x - (width - nextView.width) / 2,
        y: nextView.y - (height - nextView.height) / 2, width: width, height: height,
        spanKm: nextView.spanKm * factor, targetSpanKm: nextView.targetSpanKm * factor});
    }
    view = map.render(nextView, mapSize) || nextView;
    const viewBox = [view.x, view.y, view.width, view.height].map(function (n) { return n.toFixed(4); }).join(' ');
    if (svg.getAttribute('viewBox') !== viewBox) svg.setAttribute('viewBox', viewBox);
    // Movement stays at ~30 fps; an empty, settled radar needs only 4 ticks/s.
    frameInterval = positions.length || Math.abs(view.spanKm - view.targetSpanKm) > .01 ? 32 : 250;
    const nextId = selected && selected.id;
    if (nextId !== selectedId) {
      selectedId = nextId;
      lastLabels = 0;
      requestMetadata(selected, now, generation);
    }
    screen.classList.toggle('has-selected-aircraft', !!selected);
    if (config().theme === 'sage' && selected) {
      const point = cameraPoint(selected, view, mapSize);
      const x = Math.max(4, Math.min(mapSize.width - Math.min(180, mapSize.width * .3), point.x + 24));
      const y = Math.max(4, Math.min(mapSize.height - 24, point.y - 10));
      sagePhase.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)';
      sagePhase.hidden = false;
    } else sagePhase.hidden = true;
    const homePoint = cameraPoint(config().location, view, mapSize);
    homeMarker.style.transform = 'translate3d(' + homePoint.x.toFixed(2) + 'px,' + homePoint.y.toFixed(2) + 'px,0)';
    const present = new Set();
    positions.forEach(function (aircraft) {
      present.add(aircraft.id);
      let marker = markers.get(aircraft.id);
      if (!marker) {
        marker = document.createElement('img');
        marker.onerror = function () {
          marker.dataset.iconError = marker.dataset.iconKey || 'aircraft';
          console.warn('Aircraft marker image unavailable');
        };
        marker.alt = '';
        marker.className = 'flight-marker';
        marker.dataset.aircraftId = aircraft.id;
        el.markers.appendChild(marker);
        markers.set(aircraft.id, marker);
      }
      const extra = (metadata.get(aircraft.id + ':' + aircraft.callsign) || {}).value || {};
      const icon = resolveAircraftIcon(aircraft.icaoType, extra.icaoType);
      if (marker.dataset.iconKey !== icon.key) {
        marker.dataset.iconKey = icon.key;
        // Preload before replacing a ready image; ignore obsolete completions.
        const pending = new Image();
        const key = icon.key;
        pending.onload = function () {
          if (marker.dataset.iconKey === key) marker.src = pending.src;
        };
        pending.onerror = function () {
          if (marker.dataset.iconKey !== key) return;
          marker.dataset.iconError = key;
          console.warn('Aircraft icon failed:', key);
          if (key !== 'aircraft') marker.src = resolveAppUrl('assets/flights/aircraft.png');
        };
        if (!marker.getAttribute('src')) marker.src = resolveAppUrl('assets/flights/aircraft.png');
        pending.src = resolveAppUrl('assets/flights/' + key + '.png');
      }
      const point = cameraPoint(aircraft, view, mapSize);
      marker.style.transform = 'translate3d(' + point.x.toFixed(2) + 'px,' + point.y.toFixed(2) + 'px,0) rotate(' + aircraft.heading.toFixed(1) + 'deg) scale(' + aircraftMarkerScale(view.spanKm).toFixed(4) + ')';
      marker.classList.toggle('is-selected', aircraft.id === selectedId);
      marker.classList.toggle('is-stale', aircraft.stale);
    });
    markers.forEach(function (marker, id) {
      if (!present.has(id)) { marker.remove(); markers.delete(id); }
    });
    const liveTrails = new Set();
    tracker.trails(now).forEach(function(segment) {
      liveTrails.add(segment.id);
      let trail = trailElements.get(segment.id);
      if (!trail) {
        trail = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        trail.setAttribute('fill', 'none');
        trail.dataset.pointsAt = '';
        trailElements.set(segment.id, trail);
        el.trails.appendChild(trail);
      }
      if (trail.dataset.pointsAt !== String(segment.points.length) + ':' + segment.points[segment.points.length - 1].at) {
        const points = segment.points.map(function(p) { return projectFlightNear(p, projectFlight(config().location).x); }).map(function(p) {
          return p.x.toFixed(3) + ',' + p.y.toFixed(3);
        }).join(' ');
        trail.setAttribute('points', points);
        trail.dataset.pointsAt = String(segment.points.length) + ':' + segment.points[segment.points.length - 1].at;
      }
      if (!lastTrailStyle || now - lastTrailStyle >= 950 || trail.dataset.selected !== String(segment.flightId === selectedId)) {
        trail.style.stroke = segment.flightId === selectedId ? 'var(--flight-trail, #ff8b42)' : 'var(--flight-trail-other, #b96b3d)';
        trail.style.opacity = String(segment.opacity * (segment.flightId === selectedId ? .72 : .28));
        trail.style.strokeWidth = segment.flightId === selectedId ? '3px' : '2px';
        trail.dataset.selected = String(segment.flightId === selectedId);
      }
    });
    trailElements.forEach(function(trail, id) {
      if (!liveTrails.has(id)) { trail.remove(); trailElements.delete(id); }
    });
    if (!lastTrailStyle || now - lastTrailStyle >= 950) lastTrailStyle = now;
    if (selected && selected.history.length) {
      if (!liveConnector) {
        liveConnector = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        liveConnector.setAttribute('fill', 'none');
        liveConnector.style.stroke = 'var(--flight-trail, #ff8b42)';
        liveConnector.style.strokeWidth = '3px';
        liveConnector.style.opacity = '.72';
        el.trails.appendChild(liveConnector);
      }
      const endpoints = [selected.history[selected.history.length - 1], selected].map(function(p) { return projectFlightNear(p, projectFlight(config().location).x); })
        .map(function(p) { return p.x.toFixed(3) + ',' + p.y.toFixed(3); }).join(' ');
      liveConnector.setAttribute('points', endpoints);
    } else if (liveConnector) {
      liveConnector.remove(); liveConnector = null;
    }
    if (!lastLabels || now - lastLabels > 950) {
      updateLabels(positions, selected, now);
      text(el.phase, tr(view.phase));
      text(el['detail-phase'], tr(view.phase));
      text(sagePhase, tr(view.phase));
      text(el.scale, distance(view.spanKm, config().units, config().language).toUpperCase() + (config().language === 'en' ? ' MAP WIDTH' : ' DE MAPA'));
      text(outerScale, el.scale.textContent);
      el.map.dataset.cameraSpanKm = view.spanKm.toFixed(3);
      screen.dataset.selectedAircraft = selectedId || '';
      screen.dataset.lastFeedAt = String(lastSuccess);
      lastLabels = now;
    }
  }

  function pause() {
    running = false;
    generation += 1;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    client.cancel();
    map.pause();
  }
  function syncVisibility() {
    const visible = active && !document.hidden && !document.body.classList.contains('app-inactive');
    if (visible === running) return;
    if (!visible) { pause(); return; }
    running = true;
    generation += 1;
    resize();
    map.resume();
    frame = requestAnimationFrame(render);
    poll();
  }
  return {
    start: function () {
      if (active) return;
      active = true;
      screen.hidden = false;
      currentConfig = normalizeFlightConfig(getConfig().flights);
      screen.dataset.theme = currentConfig.theme || 'classic';
      root.classList.toggle('noir-active', currentConfig.theme === 'noir');
      // Move the explanation outside the compact telemetry row so it stays
      // visible even when the measured barometric altitude is below zero.
      if (currentConfig.theme === 'noir') screen.appendChild(el['altitude-note']);
      else screen.querySelectorAll('.flight-reading')[1].appendChild(el['altitude-note']);
      map.setTheme(currentConfig.theme);
      camera = createFlightCamera(currentConfig.location, currentConfig.radiusKm);
      paintZone();
      document.addEventListener('visibilitychange', syncVisibility);
      window.addEventListener('resize', resize);
      observer.observe(document.body, {attributes: true, attributeFilter: ['class']});
      syncVisibility();
    },
    stop: function () {
      active = false;
      pause();
      screen.hidden = true;
      root.classList.remove('noir-active');
      document.removeEventListener('visibilitychange', syncVisibility);
      window.removeEventListener('resize', resize);
      observer.disconnect();
      tracker.clear();
      trailElements.forEach(function(trail) { trail.remove(); });
      trailElements.clear();
      if (liveConnector) liveConnector.remove();
      liveConnector = null;
      map.clear();
      currentConfig = null;
      view = null;
      metadata.clear();
      markers.forEach(function (marker) { marker.remove(); });
      markers.clear();
      selectedId = null;
      lastFrame = 0;
      frameInterval = 32;
      lastLabels = 0;
      lastSuccess = 0;
      failures = 0;
    }
  };
}
