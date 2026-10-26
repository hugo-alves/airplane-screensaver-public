import {t} from './preferences.js';
import {createFlightScreensaver} from './flight-screensaver.js';
import {normalizeFlightConfig, supportedFlightLocation, advancePosition} from './flight-tracking.js';

async function boot() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('airplane-screensaver.zone') || '{}'); } catch (err) { /* city default */ }
  const params = new URLSearchParams(location.search);
  const designPreview = params.get('design') === 'quiet';
  const simulation = params.get('simulation') === '1';
  if (designPreview) document.body.classList.add('design-preview');
  const publicPreview = true;
  // Explicit test mode needs no personal location on a fresh browser. This
  // public city centre stays in memory unless the user changes and saves it.
  const initial = simulation && !saved.location ? {location: {name: 'Paris · demo', latitude: 48.8566, longitude: 2.3522}, radiusKm: 5} : saved;
  let config = {flights: normalizeFlightConfig(initial)};
  const seedSeconds = params.get('phase') === 'overhead' ? 44 : params.get('phase') === 'departure' ? 70 : 0;
  const started = Date.now();
  let sequence = 0;
  // Explicitly labelled, preview-only camera test. Live mode never uses this.
  const testClient = {
    nearby: function () {
      sequence += 1;
      const elapsed = ((Date.now() - started) / 1000 + seedSeconds) % 105;
      const start = advancePosition(config.flights.location, 245, 252, 44);
      const position = advancePosition(start, 245, 72, elapsed);
      return Promise.resolve({now: Date.now(), ac: [{hex: 'aabbcc', flight: 'TEST1234',
        lat: position.latitude + (sequence % 2 ? 0 : .00015), lon: position.longitude,
        alt_baro: 2690, gs: 245 / 1.852, track: 72, seen_pos: .3}]});
    },
    metadata: function () { return Promise.resolve({response: {aircraft: {type: config.flights.language === 'en' ? 'Airbus A320 · test' : 'Airbus A320 · teste'},
      flightroute: {callsign_iata: 'TEST1234', airline: {name: config.flights.language === 'en' ? 'SIMULATED DATA' : 'DADOS SIMULADOS'},
        origin: {municipality: 'Paris'}, destination: {municipality: 'London'}}}}); },
    cancel: function () {}
  };
  const testLink = document.querySelector('.preview-test-link');
  if (simulation) {
    const label = document.createElement('div');
    label.className = 'preview-simulation';
    label.textContent = 'TESTE DE CÂMARA · DADOS SIMULADOS' + (publicPreview ? ' · REFERÊNCIA PÚBLICA' : '');
    document.getElementById('preview-shell').appendChild(label);
    testLink.href = '/'; testLink.textContent = 'VOLTAR A DADOS REAIS';
  }
  const designCase = params.get('case');
  const designClient = {
    nearby: function () {
      if (designCase === 'offline') return Promise.reject(new Error('Preview offline state'));
      const p = advancePosition(config.flights.location, 360, 28, 16);
      return Promise.resolve({now: Date.now(), ac: designCase === 'empty' ? [] : [{hex:'aabbcc', flight:'TAP1933',
        lat:p.latitude, lon:p.longitude, alt_baro:800, gs:0, track:28, seen_pos:0}]});
    },
    metadata: function () { return Promise.resolve({response:{aircraft:{type:'EMB-190 LR'},flightroute:{
      airline:{name:designCase === 'long' ? 'Transportes Aéreos Portugueses' : 'TAP Portugal'},
      origin:{municipality:designCase === 'long' ? 'São Francisco' : 'Porto'},
      destination:{municipality:designCase === 'long' ? 'New York' : 'London'}}}}); },
    cancel: function () {}
  };
  if (designPreview) {
    const label = document.createElement('div'); label.className = 'preview-simulation';
    label.textContent = 'PRÉ-VISUALIZAÇÃO · DADOS DE EXEMPLO · REFERÊNCIA PÚBLICA';
    document.getElementById('preview-shell').appendChild(label);
  }
  const radar = createFlightScreensaver({rootEl: document.getElementById('preview-root'),
    getConfig: function () { return config; }, client: designPreview ? designClient : simulation ? testClient : undefined,
    previewTime: designPreview ? '21:42' : undefined,
    homeLabel: 'REFERÊNCIA'});
  if (saved.location || simulation) radar.start();
  window.addEventListener('pagehide', function () { radar.stop(); });
  const button = document.querySelector('.preview-zone-button');
  const form = document.querySelector('.preview-controls');
  function fillForm() {
    form.elements.name.value = config.flights.location.name;
    form.elements.latitude.value = config.flights.location.latitude;
    form.elements.longitude.value = config.flights.location.longitude;
    form.elements.radius.value = config.flights.units === 'aviation' ? +(config.flights.radiusKm / 1.852).toFixed(2) : +config.flights.radiusKm.toFixed(2);
    form.elements.language.value = config.flights.language;
    form.elements.units.value = config.flights.units;
  }
  const originalText = new Map();
  [form, button, testLink, document.querySelector('.preview-simulation')].filter(Boolean).forEach(function(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, value = node.nodeValue.trim();
      if (value) originalText.set(node, value);
    }
  });
  function localize() {
    const language = form.elements.language.value;
    document.documentElement.lang = language;
    originalText.forEach(function(value, node) { node.nodeValue = t(value, language); });
    form.elements.cityQuery.placeholder = t('Cidade', language);
    const aviation = form.elements.units.value === 'aviation';
    form.querySelector('.radius-label').textContent = language === 'en' ? 'Observation radius (' + (aviation ? 'NM' : 'km') + ')' : 'Raio de observação (' + (aviation ? 'NM' : 'km') + ')';
    form.elements.radius.min = aviation ? '0.54' : '1';
    form.elements.radius.max = aviation ? '27' : '50';
    form.elements.radius.step = '0.01';
  }
  form.elements.language.addEventListener('change', localize);
  let previousUnits = config.flights.units;
  form.elements.units.addEventListener('change', function () {
    const radius = Number(form.elements.radius.value);
    if (previousUnits !== form.elements.units.value && Number.isFinite(radius)) {
      form.elements.radius.value = +(previousUnits === 'metric' ? radius / 1.852 : radius * 1.852).toFixed(2);
    }
    previousUnits = form.elements.units.value; localize();
  });
  fillForm();
  localize();
  if (!saved.location && !simulation) { form.elements.name.value = ""; form.elements.latitude.value = ""; form.elements.longitude.value = ""; }
  const searchButton = form.querySelector('.city-search');
  const results = form.elements.cityResult;
  let cities = [];
  searchButton.addEventListener('click', async function () {
    const message = form.querySelector('.preview-error');
    message.textContent = '';
    searchButton.disabled = true;
    try {
      const response = await fetch('/api/cities?q=' + encodeURIComponent(form.elements.cityQuery.value.trim()));
      if (!response.ok) throw new Error('search failed');
      cities = (await response.json()).results;
      results.replaceChildren(new Option(t('Escolhe um resultado', form.elements.language.value), ''));
      cities.forEach(function (city, i) {
        results.add(new Option([city.name, city.region, city.country].filter(Boolean).join(', '), String(i)));
      });
      if (!cities.length) message.textContent = t('Não encontrámos cidades com esse nome.', form.elements.language.value);
      else results.focus();
    } catch (err) { message.textContent = t('Não foi possível pesquisar. Tenta novamente ou introduz as coordenadas.', form.elements.language.value); }
    finally { searchButton.disabled = false; }
  });
  results.addEventListener('change', function () {
    if (results.value === '') return;
    const city = cities[Number(results.value)];
    form.elements.name.value = [city.name, city.country].filter(Boolean).join(', ').slice(0, 40);
    form.elements.latitude.value = city.latitude;
    form.elements.longitude.value = city.longitude;
  });
  if (!saved.location && !simulation) { form.hidden = false; button.setAttribute('aria-expanded', 'true'); }
  button.addEventListener('click', function () {
    form.hidden = !form.hidden;
    button.setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) form.elements.name.focus();
  });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const latitude = Number(form.elements.latitude.value);
    const longitude = Number(form.elements.longitude.value);
    if (!supportedFlightLocation(latitude, longitude)) {
      form.querySelector('.preview-error').textContent = t('Escolhe coordenadas válidas (latitude entre −85 e 85; longitude entre −180 e 180).', form.elements.language.value);
      return;
    }
    const radiusInput = Number(form.elements.radius.value);
    const radius = form.elements.units.value === 'aviation' ? Math.min(50, Math.max(1, radiusInput * 1.852)) : radiusInput;
    if (!Number.isFinite(radiusInput) || radiusInput < Number(form.elements.radius.min) || radiusInput > Number(form.elements.radius.max)) { form.querySelector('.preview-error').textContent = t('Escolhe um raio entre 1 e 50 km.', form.elements.language.value); return; }
    config.flights = normalizeFlightConfig({location: {name: form.elements.name.value.trim() || 'Zona definida',
      latitude: latitude, longitude: longitude}, radiusKm: radius, language: form.elements.language.value, units: form.elements.units.value});
    localStorage.setItem('airplane-screensaver.zone', JSON.stringify(Object.assign({}, config.flights, {userLocation: true})));
    form.querySelector('.preview-error').textContent = '';
    radar.stop(); radar.start();
    form.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  });
}
boot();
