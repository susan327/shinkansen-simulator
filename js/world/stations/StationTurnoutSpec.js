"use strict";
/** 本線と待避線の前後方向遷移だけを管理する。 */
(() => {
  const PRESETS = Object.freeze({
    origin: Object.freeze({ approachLength: 80, transitionLength: 416, parallelBefore: 424, parallelAfter: 80 }),
    passHighSpeed: Object.freeze({ approachLength: 120, transitionLength: 1200, parallelBefore: 500, parallelAfter: 120 }),
    passMedium: Object.freeze({ approachLength: 100, transitionLength: 760, parallelBefore: 460, parallelAfter: 100 }),
    terminal: Object.freeze({ approachLength: 100, transitionLength: 520, parallelBefore: 440, parallelAfter: 100 })
  });
  function resolve(stationId = "asahigaoka") {
    const station = window.ATC_getStationConfig?.(stationId);
    if (!station) throw new Error("StationTurnoutSpec requires station config.");
    const preset = station.role === "origin" ? PRESETS.origin
      : station.role === "terminal" ? PRESETS.terminal
      : Number(station.speedKmh || 0) >= 250 ? PRESETS.passHighSpeed : PRESETS.passMedium;
    return Object.freeze({ ...preset, ...(station.turnout || {}) });
  }
  function smoothstep(t) { const x=Math.max(0,Math.min(1,t)); return x*x*(3-2*x); }
  window.StationTurnoutSpec = Object.freeze({ version: "74.0.0-beta11", presets: PRESETS, resolve, smoothstep });
})();
