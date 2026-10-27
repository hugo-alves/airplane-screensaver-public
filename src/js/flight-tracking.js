import {normalizeIcaoType} from './flight-aircraft-icons.js';
// Flight positions are observations; movement between them is a bounded estimate.
// This module has no DOM or network dependencies, so timing/geometry can be tested.
const RAD = Math.PI / 180;
const EARTH_KM = 6371;
export const PREDICT_SECONDS = 20;
export const STALE_SECONDS = 25;
export const EXPIRE_SECONDS = 60;
export const TRAIL_RETENTION_MS = 5 * 60 * 1000;
export const TRAIL_MAX_SEGMENTS = 40;
export const TRAIL_MAX_POINTS = 1200;
export const TRAIL_MAX_POINTS_PER_SEGMENT = 120;
export const CORRECTION_MS = 1800;
export const MAP_BOUNDS = {west: -180, east: 180, south: -85.05112878, north: 85.05112878};
export const MAP_WIDTH = 1200;
function mercator(latitude) { return Math.log(Math.tan(Math.PI / 4 + latitude * RAD / 2)); }
export const MAP_HEIGHT = MAP_WIDTH * (mercator(MAP_BOUNDS.north) - mercator(MAP_BOUNDS.south)) /
  ((MAP_BOUNDS.east - MAP_BOUNDS.west) * RAD);

function finite(value) { return typeof value === 'number' && isFinite(value); }
export function supportedFlightLocation(latitude, longitude) {
  return finite(latitude) && finite(longitude) && latitude >= MAP_BOUNDS.south &&
    latitude <= MAP_BOUNDS.north && longitude >= MAP_BOUNDS.west && longitude <= MAP_BOUNDS.east;
}

export function normalizeFlightConfig(raw) {
  const input = raw || {};
  const loc = input.location || {};
  const valid = supportedFlightLocation(loc.latitude, loc.longitude);
  return {
    location: valid ? {name: String(loc.name || 'Zona definida').slice(0, 40),
      latitude: loc.latitude, longitude: loc.longitude}
      : {name: 'London', latitude: 51.5072, longitude: -0.1276},
    radiusKm: finite(input.radiusKm) && input.radiusKm >= 1 && input.radiusKm <= 50 ? input.radiusKm : 5,
    language: input.language === 'en' ? 'en' : 'pt',
    units: input.units === 'aviation' ? 'aviation' : 'metric',
    theme: ['classic', 'coast', 'lavender', 'sage', 'evangelion', 'noir'].indexOf(input.theme) !== -1 ? input.theme : 'classic',
    pollSeconds: 10
  };
}

export function distanceKm(a, b) {
  const dLat = (b.latitude - a.latitude) * RAD;
  const dLon = (b.longitude - a.longitude) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * RAD) *
    Math.cos(b.latitude * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function advancePosition(position, speedKmh, heading, seconds) {
  const angular = Math.max(0, speedKmh) / 3600 * Math.max(0, seconds) / EARTH_KM;
  const lat = position.latitude * RAD;
  const lon = position.longitude * RAD;
  const bearing = heading * RAD;
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(angular) +
    Math.cos(lat) * Math.sin(angular) * Math.cos(bearing));
  const nextLon = lon + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
    Math.cos(angular) - Math.sin(lat) * Math.sin(nextLat));
  return {latitude: nextLat / RAD, longitude: ((nextLon / RAD + 540) % 360) - 180};
}

export function projectFlight(position) {
  return {x: (position.longitude - MAP_BOUNDS.west) / (MAP_BOUNDS.east - MAP_BOUNDS.west) * MAP_WIDTH,
    y: (mercator(MAP_BOUNDS.north) - mercator(position.latitude)) /
      (mercator(MAP_BOUNDS.north) - mercator(MAP_BOUNDS.south)) * MAP_HEIGHT};
}

export function zoneRadiusPixels(radiusKm, latitude) {
  return radiusKm / (EARTH_KM * Math.cos(latitude * RAD) *
    (MAP_BOUNDS.east - MAP_BOUNDS.west) * RAD) * MAP_WIDTH;
}

// A negative pressure altitude can be reported near the ground; it does not
// establish ground status or height above terrain. Do not invent a zero value.
export function altitudeDisposition(value) {
  return !finite(value) ? 'unavailable' : value < 0 ? 'below-zero' : 'valid';
}

export function readAircraftFeed(data, receivedAt) {
  if (!data || !Array.isArray(data.ac) || !finite(data.now)) throw new Error('Invalid aircraft feed');
  const sourceTime = data.now > 1e12 ? data.now : data.now * 1000;
  // A slightly fast server clock must not make an old observation look fresh.
  const sourceAge = Math.max(0, receivedAt - sourceTime);
  return data.ac.slice(0, 200).map(function (raw) {
    if (!raw || !/^~?[a-f0-9]{6}$/i.test(raw.hex || '') || !finite(raw.lat) ||
        !finite(raw.lon) || Math.abs(raw.lat) > 85 || Math.abs(raw.lon) > 180 ||
        !finite(raw.seen_pos) || raw.seen_pos < 0 || raw.ground === true || raw.alt_baro === 'ground') return null;
    const age = raw.seen_pos + sourceAge / 1000;
    if (age >= EXPIRE_SECONDS) return null;
    return {
      id: raw.hex.toLowerCase(), callsign: String(raw.flight || '').trim().slice(0, 16),
      icaoType: normalizeIcaoType(raw.t),
      registration: String(raw.r || '').slice(0, 24), model: String(raw.t || '').slice(0, 24),
      latitude: raw.lat, longitude: raw.lon, reportedAt: receivedAt - age * 1000,
      speedKmh: finite(raw.gs) && raw.gs >= 0 && raw.gs <= 1500 ? raw.gs * 1.852 : null,
      heading: finite(raw.track) ? ((raw.track % 360) + 360) % 360 : null,
      altitudeM: finite(raw.alt_baro) ? raw.alt_baro * 0.3048 : null
    };
  }).filter(Boolean);
}

function shortestAngle(from, to) { return ((to - from + 540) % 360) - 180; }
function estimate(report, now) {
  const elapsed = Math.min(PREDICT_SECONDS, Math.max(0, (now - report.reportedAt) / 1000));
  return report.speedKmh !== null && report.heading !== null
    ? advancePosition(report, report.speedKmh, report.heading, elapsed)
    : {latitude: report.latitude, longitude: report.longitude};
}

export function createFlightTracker() {
  const tracks = new Map();
  const archived = [];
  function close(track, now) {
    if (!track || !track.history || track.history.length < 2) return;
    track.history.endedAt = now;
    archived.push(track.history);
  }
  function prune(now) {
    for (let i = archived.length - 1; i >= 0; i--) {
      if (now - archived[i][archived[i].length - 1].at >= TRAIL_RETENTION_MS) archived.splice(i, 1);
    }
    while (archived.length > TRAIL_MAX_SEGMENTS) archived.shift();
    let count = archived.reduce(function(n, segment) { return n + segment.length; }, 0);
    tracks.forEach(function(track) { count += track.history.length; });
    while (count > TRAIL_MAX_POINTS && archived.length) count -= archived.shift().length;
    if (count > TRAIL_MAX_POINTS) {
      tracks.forEach(function(track) {
        while (count > TRAIL_MAX_POINTS && track.history.length > 2) { track.history.shift(); count--; }
      });
    }
  }
  function position(track, now) {
    const predicted = estimate(track.report, now);
    const t = Math.min(1, Math.max(0, (now - track.correctedAt) / CORRECTION_MS));
    // Smoothstep: no visual jump when a new report replaces the estimate.
    const residual = 1 - t * t * (3 - 2 * t);
    return Object.assign({}, track.report, {
      latitude: predicted.latitude + track.offset.latitude * residual,
      longitude: predicted.longitude + track.offset.longitude * residual,
      heading: ((track.report.heading || 0) + track.offset.heading * residual + 360) % 360,
      ageSeconds: Math.max(0, (now - track.report.reportedAt) / 1000),
      stale: now - track.report.reportedAt >= STALE_SECONDS * 1000,
      history: track.history
    });
  }
  return {
    ingest: function (reports, now) {
      reports.forEach(function (report) {
        const previous = tracks.get(report.id);
        if (previous && report.reportedAt <= previous.report.reportedAt + 1) return;
        const target = estimate(report, now);
        const current = previous ? position(previous, now) : null;
        // A discontinuous track is reacquired, never animated across the city.
        const sameFlight = !previous || !previous.report.callsign || !report.callsign ||
          previous.report.callsign === report.callsign;
        const continuous = current && sameFlight && distanceKm(current, target) < 3 && !current.stale;
        if (previous && !continuous) close(previous, now);
        const history = continuous ? previous.history : [];
        if (!history.length) { history.endedAt = null; history.flightId = report.id; }
        if (!history.length || now - history[history.length - 1].at >= 9000) {
          history.push({latitude: report.latitude, longitude: report.longitude, at: report.reportedAt});
        }
        while (history.length > TRAIL_MAX_POINTS_PER_SEGMENT) history.shift();
        tracks.set(report.id, {report: report, correctedAt: now, history: history,
          offset: continuous ? {latitude: current.latitude - target.latitude,
            longitude: current.longitude - target.longitude,
            heading: shortestAngle(report.heading || 0, current.heading)}
            : {latitude: 0, longitude: 0, heading: 0}});
      });
      tracks.forEach(function (track, id) {
        if (now - track.report.reportedAt >= EXPIRE_SECONDS * 1000) { close(track, now); tracks.delete(id); }
      });
      prune(now);
    },
    positions: function (now) {
      const result = [];
      tracks.forEach(function (track, id) {
        if (now - track.report.reportedAt >= EXPIRE_SECONDS * 1000) { close(track, now); tracks.delete(id); }
        else result.push(position(track, now));
      });
      return result;
    },
    trails: function(now) {
      prune(now);
      const result = archived.slice();
      tracks.forEach(function(track) { if (track.history.length > 1) result.push(track.history); });
      return result.map(function(segment) {
        const completedAt = segment[segment.length - 1].at;
        const age = Math.max(0, now - completedAt);
        return {id: segment.flightId + ':' + segment[0].at, flightId: segment.flightId,
          points: segment, ageMs: age,
          opacity: Math.max(0, 1 - age / TRAIL_RETENTION_MS)};
      });
    },
    clear: function () { tracks.clear(); archived.length = 0; }
  };
}

export function selectAircraft(positions, location, currentId) {
  const candidates = positions.filter(function (p) {
    return !p.stale && supportedFlightLocation(p.latitude, p.longitude);
  }).map(function (p) { return {aircraft: p, distance: distanceKm(location, p)}; })
    .sort(function (a, b) { return a.distance - b.distance; });
  if (!candidates.length) return null;
  const closest = candidates[0];
  const current = candidates.find(function (entry) { return entry.aircraft.id === currentId; });
  if (!current || current === closest) return closest.aircraft;
  const plane = current.aircraft;
  const departing = finite(plane.speedKmh) && finite(plane.heading) &&
    distanceKm(location, advancePosition(plane, plane.speedKmh, plane.heading, 5)) > current.distance + .01;
  // Once a passage is moving away, any closer fresh aircraft takes priority.
  // Only approaching/unknown tracks get a 50m near-tie tolerance against jitter.
  const toleranceKm = departing ? 0 : .05;
  return closest.distance + toleranceKm < current.distance ? closest.aircraft : plane;
}
