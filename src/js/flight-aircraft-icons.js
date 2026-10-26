// Original schematic family outlines. Runtime paths never contain feed text.
export function normalizeIcaoType(value) {
  if (typeof value !== 'string' || value.length > 32) return '';
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{2,4}$/.test(code) ? code : '';
}
const AIRCRAFT_ICONS = {
  E190:'e190', E195:'e195', E290:'e190', E295:'e195',
  A319:'a319', A320:'a320', A20N:'a320', A321:'a321', A21N:'a321',
  B737:'b737', B738:'b738', B739:'b739', B37M:'b737', B38M:'b738', B39M:'b739',
  A332:'a330', A333:'a330', A338:'a330', A339:'a330', A359:'a350', A35K:'a350'
};
export function resolveAircraftIcon(feedType, metadataType) {
  const icaoType = normalizeIcaoType(feedType) || normalizeIcaoType(metadataType);
  const key = Object.prototype.hasOwnProperty.call(AIRCRAFT_ICONS, icaoType) ? AIRCRAFT_ICONS[icaoType] : 'aircraft';
  return {key: key, quality: key === 'aircraft' ? 'generic' : 'family', icaoType: icaoType};
}
