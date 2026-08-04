"use strict";

/** v72.1.0 駅データ駆動設定。
 * 駅固有の差分はここへ集約し、描画ロジックへ固定値を書かない。
 */
(() => {
  const routeStations = window.ATC_ROUTE_V675?.stations || [];
  const byId = Object.fromEntries(routeStations.map(station => [station.id, station]));
  const base = (id, extra) => Object.freeze({
    id,
    name: byId[id]?.name || extra.name,
    platformLengthM: Number(byId[id]?.platformLengthM || extra.platformLengthM || 420),
    platformWidthM: Number(extra.platformWidthM || 12),
    platformType: extra.platformType,
    role: byId[id]?.role || extra.role,
    direction: "right",
    operatingTrack: byId[id]?.operatingTrack || extra.operatingTrack || "left-main",
    roof: Object.freeze(extra.roof),
    stairs: Object.freeze((extra.stairs || []).map(Object.freeze)),
    furniture: Object.freeze(extra.furniture || {}),
    boarding: Object.freeze(extra.boarding || {}),
    camera: Object.freeze(extra.camera),
    environment: Object.freeze(extra.environment || {}),
    trackSpacing: Object.freeze(extra.trackSpacing || {}),
    turnout: Object.freeze(extra.turnout || {}),
    speedKmh: Number(byId[id]?.speedKmh || extra.speedKmh || 0)
  });

  window.ATC_STATION_CONFIGS = Object.freeze({
    asahigaoka: base("asahigaoka", {
      name: "旭ヶ丘", platformLengthM: 424, platformWidthM: 13.5,
      platformType: "two-island-four-track", role: "origin", operatingTrack: "left-outer",
      roof: { coverageRatio: 0.58, widthM: 5.6, heightM: 5.7, cameraSideInsetM: 1.0 },
      stairs: [{ positionRatio: 0.36, direction: "parallel", side: "inner", widthM: 3.2, runM: 8.0 }],
      furniture: { benches: 4, signs: 4, vendingMachines: 2 },
      boarding: { enabled: true, density: "medium", alightCount: 9, boardCount: 12, remainCount: 8 },
      camera: { side: "outer", heightM: 5.6, distanceM: 31, lateralM: 18, targetRatio: 0.72, fov: 49, driftM: 0.16 },
      environment: { theme: "urban-elevated" },
      trackSpacing: { mainToMain: 5.0, trackToPlatformEdge: 1.76 },
      turnout: { approachLength: 80, transitionLength: 416, parallelBefore: 424, parallelAfter: 80 }
    }),
    sakurano: base("sakurano", {
      name: "桜野", platformLengthM: 420, platformWidthM: 9.0,
      platformType: "side-four-track", role: "pass",
      roof: { coverageRatio: 0.50, widthM: 4.8, heightM: 5.4, cameraSideInsetM: 0.8 },
      stairs: [{ positionRatio: 0.48, direction: "parallel", side: "outer", widthM: 3.0, runM: 7.5 }],
      furniture: { benches: 3, signs: 4, vendingMachines: 1 },
      boarding: { enabled: false, density: "low" },
      camera: { side: "outer", heightM: 5.2, distanceM: 29, lateralM: 16, targetRatio: 0.58, fov: 48, driftM: 0.10 },
      environment: { theme: "urban-pass" },
      trackSpacing: { mainToMain: 5.0, mainToSiding: 4.8 },
      turnout: { approachLength: 120, transitionLength: 1200, parallelBefore: 500, parallelAfter: 120 }
    }),
    aomine: base("aomine", {
      name: "青峰", platformLengthM: 420, platformWidthM: 8.5,
      platformType: "side-two-track", role: "pass",
      roof: { coverageRatio: 0.46, widthM: 4.5, heightM: 5.3, cameraSideInsetM: 0.7 },
      stairs: [{ positionRatio: 0.52, direction: "parallel", side: "outer", widthM: 2.8, runM: 7.0 }],
      furniture: { benches: 2, signs: 3, vendingMachines: 1 },
      boarding: { enabled: false, density: "low" },
      camera: { side: "outer", heightM: 5.0, distanceM: 27, lateralM: 15, targetRatio: 0.62, fov: 47, driftM: 0.08 },
      environment: { theme: "suburban-curve" }
    }),
    shiomichuo: base("shiomichuo", {
      name: "潮見中央", platformLengthM: 424, platformWidthM: 13.5,
      platformType: "two-island-four-track", role: "terminal", operatingTrack: "left-main",
      roof: { coverageRatio: 0.62, widthM: 5.8, heightM: 5.8, cameraSideInsetM: 1.0 },
      stairs: [
        { positionRatio: 0.30, direction: "parallel", side: "inner", widthM: 3.2, runM: 8.0 },
        { positionRatio: 0.68, direction: "parallel", side: "inner", widthM: 3.2, runM: 8.0 }
      ],
      furniture: { benches: 5, signs: 5, vendingMachines: 2 },
      boarding: { enabled: true, density: "high", alightCount: 18, boardCount: 0, remainCount: 2 },
      camera: { side: "outer", heightM: 5.8, distanceM: 32, lateralM: 19, targetRatio: 0.42, fov: 50, driftM: 0.14 },
      environment: { theme: "terminal-urban" }
    })
  });

  window.ATC_getStationConfig = stationId =>
    window.ATC_STATION_CONFIGS[stationId] || window.ATC_STATION_CONFIGS.asahigaoka;
})();
