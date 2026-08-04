"use strict";
/** 乗客をホーム安全領域内へ拘束する。線路座標は扱わない。 */
(() => {
  function clampPoint(point, zone, margin = 0.05) {
    return {
      x: Math.max(zone.x.min + margin, Math.min(zone.x.max - margin, Number(point.x))),
      z: Math.max(zone.z.min + margin, Math.min(zone.z.max - margin, Number(point.z)))
    };
  }
  function contains(point, zone) {
    return point.x >= zone.x.min && point.x <= zone.x.max && point.z >= zone.z.min && point.z <= zone.z.max;
  }
  window.PassengerZoneSpec = Object.freeze({ version: "74.0.0-beta11", clampPoint, contains });
})();
