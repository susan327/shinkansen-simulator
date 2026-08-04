"use strict";
/** StationWorldSpecから描画可能な線形データを返す。Three.jsには依存しない。 */
(() => {
  function build(stationId = "asahigaoka") {
    const world = window.StationWorldSpec.resolve(stationId);
    return Object.freeze({
      stationId,
      tracks: world.tracks,
      platforms: world.platforms,
      turnout: world.turnout,
      lateralAt(trackId, longitudinalM, phase = "parallel") {
        const track = world.tracks.find(t => t.id === trackId);
        if (!track) throw new Error(`Unknown track: ${trackId}`);
        if (track.role !== "siding" || phase === "parallel") return track.centerZ;
        const main = world.tracks.find(t => t.direction === track.direction && t.role === "main");
        if (!main) return track.centerZ;
        const u = window.StationTurnoutSpec.smoothstep(longitudinalM);
        return phase === "entry" ? main.centerZ + (track.centerZ-main.centerZ)*u
          : track.centerZ + (main.centerZ-track.centerZ)*u;
      }
    });
  }
  window.TrackLayoutBuilder = Object.freeze({ version: "74.0.0-beta11", build });
})();
