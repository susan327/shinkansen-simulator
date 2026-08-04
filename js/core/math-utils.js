/* v71.5.0 math-utils: app.js から責務分離 */

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function moveTowards(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

function kmhToMps(kmh) {
  return kmh / 3.6;
}

function mpsToKmh(mps) {
  return mps * 3.6;
}

