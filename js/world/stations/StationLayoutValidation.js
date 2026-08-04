"use strict";
/**
 * StationWorldSpec の幾何整合性を検証する。描画は行わない。
 * ホームと線路の重なり、島式ホームの縁端離隔不足を早期検出する。
 */
(() => {
  const EPSILON = 1e-6;

  function validate(stationId = "asahigaoka") {
    const world = window.StationWorldSpec?.resolve(stationId);
    if (!world) throw new Error("StationLayoutValidation requires StationWorldSpec.");

    const errors = [];
    const warnings = [];
    const requiredEdge = world.spacing.trackToPlatformEdge;

    for (const platform of world.platforms) {
      const half = platform.width / 2;
      const edges = [platform.centerZ - half, platform.centerZ + half];
      const adjacentTracks = world.tracks
        .map(track => ({ track, distance: Math.min(...edges.map(edge => Math.abs(track.centerZ - edge))) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, platform.type === "island" ? 2 : 1);

      for (const item of adjacentTracks) {
        if (item.distance + EPSILON < requiredEdge) {
          errors.push(`${platform.id} と ${item.track.id} の縁端離隔が不足: ${item.distance.toFixed(3)}m < ${requiredEdge.toFixed(3)}m`);
        }
      }
    }

    if (world.layoutType === "two-island-four-track") {
      const expected = world.spacing.platformWidth + 2 * world.spacing.trackToPlatformEdge;
      if (Math.abs(world.spacing.mainToSiding - expected) > EPSILON) {
        errors.push(`mainToSiding不整合: ${world.spacing.mainToSiding.toFixed(3)}m / expected ${expected.toFixed(3)}m`);
      }
    }

    return Object.freeze({ stationId, ok: errors.length === 0, errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
  }

  function assert(stationId = "asahigaoka") {
    const result = validate(stationId);
    if (!result.ok) throw new Error(`[StationLayoutValidation:${stationId}] ${result.errors.join(" | ")}`);
    return result;
  }

  window.StationLayoutValidation = Object.freeze({ version: "74.0.0-beta11", validate, assert });
})();
