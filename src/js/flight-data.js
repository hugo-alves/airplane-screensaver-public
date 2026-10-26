import {normalizeIcaoType} from './flight-aircraft-icons.js';
import {normalizeFlightConfig} from './flight-tracking.js';

export function aircraftUrl(rawConfig) {
  const config = normalizeFlightConfig(rawConfig);
  // The provider needs a broad search area, not a precise observation location.
  return 'https://api.adsb.lol/v2/lat/' + config.location.latitude.toFixed(2) +
    '/lon/' + config.location.longitude.toFixed(2) + '/dist/' + Math.ceil((config.radiusKm + 2) / 1.852);
}

export function aircraftMetadataUrl(id, callsign) {
  if (!/^~?[a-f0-9]{6}$/i.test(id || '')) throw new Error('Invalid aircraft identifier');
  const clean = String(callsign || '').trim();
  if (clean && !/^[a-z0-9]{2,12}$/i.test(clean)) throw new Error('Invalid callsign');
  return 'https://api.adsbdb.com/v0/aircraft/' + encodeURIComponent(id.replace(/^~/, '')) +
    (clean ? '?callsign=' + encodeURIComponent(clean) : '');
}

export function createFlightClient() {
  const pending = new Set();
  async function request(url, localPath) {
    const controller = new AbortController();
    pending.add(controller);
    const timer = setTimeout(function () { controller.abort(); }, 10000);
    try {
      const response = await fetch(localPath, {signal: controller.signal});
      if (!response.ok) throw new Error('Aircraft source unavailable');
      return await response.json();
    } finally {
      clearTimeout(timer);
      pending.delete(controller);
    }
  }
  return {
    nearby: function (config) {
      const url = aircraftUrl(config);
      const loc = normalizeFlightConfig(config).location;
      return request(url, '/api/aircraft?latitude=' + loc.latitude + '&longitude=' + loc.longitude + '&radius=' + normalizeFlightConfig(config).radiusKm);
    },
    metadata: function (aircraft) {
      return request(aircraftMetadataUrl(aircraft.id, aircraft.callsign),
        '/api/aircraft-info?id=' + encodeURIComponent(aircraft.id) +
        '&callsign=' + encodeURIComponent(aircraft.callsign));
    },
    cancel: function () { pending.forEach(function (controller) { controller.abort(); }); }
  };
}

export function readAircraftMetadata(data) {
  const response = data && data.response || {};
  const plane = response.aircraft || {};
  const route = response.flightroute || {};
  const origin = route.origin || {};
  const destination = route.destination || {};
  return {
    icaoType: normalizeIcaoType(plane.icao_type),
    model: String(plane.type || plane.icao_type || '').slice(0, 60),
    registration: String(plane.registration || '').slice(0, 24),
    airline: String((route.airline || {}).name || '').slice(0, 60),
    origin: String(origin.municipality || origin.iata_code || '').slice(0, 24),
    destination: String(destination.municipality || destination.iata_code || '').slice(0, 24),
    callsign: String(route.callsign_iata || route.callsign || '').slice(0, 16)
  };
}
