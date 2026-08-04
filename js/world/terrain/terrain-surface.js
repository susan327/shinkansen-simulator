"use strict";

/**
 * 路盤種別と線路中心からの横距離から、線路面を0とした地表面の高さを返す。
 * 景観オブジェクトは必ずこのAPIを通して接地させる。
 */
window.ATCTerrainSurface = (() => {
  function sectionAt(distanceM) {
    return window.ATCRoadbedEngine?.at(distanceM) || { type: "ground" };
  }

  function settingsFor(type) {
    return window.ATCRoadbedEngine?.settings?.[type] || {};
  }

  function offsetY(distanceM, lateralM = 0) {
    const section = sectionAt(distanceM);
    const cfg = { ...settingsFor(section.type), ...section };
    const a = Math.abs(lateralM);

    switch (section.type) {
      case "embankment": {
        const topHalf = (cfg.topWidthM || 15.5) * 0.5;
        const slopeWidth = cfg.slopeWidthM || 9.5;
        const height = cfg.heightM || 5.2;
        if (a <= topHalf) return -0.38;
        const t = Math.max(0, Math.min(1, (a - topHalf) / slopeWidth));
        return -0.38 - height * t;
      }
      case "cutting": {
        const formationHalf = (cfg.formationWidthM || 13.0) * 0.5;
        const shoulder = cfg.bottomShoulderM || 3.0;
        const slopeWidth = cfg.slopeWidthM || 10.5;
        const depth = cfg.depthM || 5.0;
        const slopeStart = formationHalf + shoulder;
        if (a <= slopeStart) return -0.35;
        const t = Math.max(0, Math.min(1, (a - slopeStart) / slopeWidth));
        return -0.35 + depth * t;
      }
      case "viaduct":
        return -9.22;
      case "bridge":
        return -10.10;
      case "tunnel":
        return 7.9;
      case "ground":
      default:
        return -0.38;
    }
  }

  return Object.freeze({ offsetY, sectionAt });
})();
