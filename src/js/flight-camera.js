import {projectFlight, distanceKm, advancePosition, zoneRadiusPixels, MAP_WIDTH} from './flight-tracking.js';

export const CLOSE_SPAN_KM = 2.2;
export const WIDE_SPAN_KM = 20;

// Scale against the camera span, never altitude. Limits keep a marker readable
// in the city view without letting it cover the map during an overhead zoom.
export function aircraftMarkerScale(spanKm) {
  return Math.max(.5, Math.min(1.5, 6 / Math.max(.01, spanKm || WIDE_SPAN_KM)));
}

// Select the nearest wrapped copy of a point across the international date line.
export function projectFlightNear(position, referenceX) {
  const point = projectFlight(position);
  point.x += Math.round((referenceX - point.x) / MAP_WIDTH) * MAP_WIDTH;
  return point;
}

// Map, aircraft and observation zone share Mercator coordinates; only the camera changes.
export function createFlightCamera(location, radiusKm) {
  const wideSpan = Math.max(WIDE_SPAN_KM, (radiusKm || 0) * 2.4);
  const home = projectFlight(location);
  const unitsPerKm = zoneRadiusPixels(1, location.latitude);
  let spanKm = wideSpan;
  let lastTime = null;
  return {
    update: function (aircraft, size, now) {
      const aspect = Math.max(.5, size.width / Math.max(1, size.height));
      let target = wideSpan;
      let phase = 'À ESCUTA';
      if (aircraft && !aircraft.stale) {
        const distance = distanceKm(location, aircraft);
        const point = projectFlightNear(aircraft, home.x);
        const fit = Math.max(Math.abs(point.x - home.x), Math.abs(point.y - home.y) * aspect) * 2.8 / unitsPerKm;
        target = Math.min(wideSpan, Math.max(CLOSE_SPAN_KM, fit,
          CLOSE_SPAN_KM + Math.max(0, distance - .5) * 2.2));
        phase = 'PASSAGEM PRÓXIMA';
        if (distance < .55) phase = 'SOBRE A ZONA';
        else if (aircraft.speedKmh !== null && aircraft.heading !== null) {
          const ahead = advancePosition(aircraft, aircraft.speedKmh, aircraft.heading, 5);
          const change = distanceKm(location, ahead) - distance;
          if (change < -.02) phase = 'EM APROXIMAÇÃO';
          else if (change > .02) phase = 'A AFASTAR-SE';
        }
      }
      const seconds = lastTime === null ? 0 : Math.min(.2, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      // Log-space easing gives equal perceived zoom speed at every scale.
      const alpha = 1 - Math.exp(-seconds / (target > spanKm ? 2.6 : 1.8));
      spanKm = Math.exp(Math.log(spanKm) + (Math.log(target) - Math.log(spanKm)) * alpha);
      const width = spanKm * unitsPerKm;
      const height = width / aspect;
      return {x: home.x - width / 2, y: home.y - height / 2,
        width: width, height: height, spanKm: spanKm, targetSpanKm: target, phase: phase};
    }
  };
}

export function cameraPoint(position, view, size) {
  const point = projectFlightNear(position, view.x + view.width / 2);
  return {x: (point.x - view.x) / view.width * size.width,
    y: (point.y - view.y) / view.height * size.height};
}
