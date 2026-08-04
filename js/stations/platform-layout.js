"use strict";

/** 実寸の駅設定をThree.js乗降シーン用の縮尺へ変換する。 */
(() => {
  window.ATC_buildPlatformLayout = function buildPlatformLayout(config, THREERef) {
    const clamp = THREERef?.MathUtils?.clamp || ((v, min, max) => Math.max(min, Math.min(max, v)));
    const length = clamp(Number(config.platformLengthM) * 0.17, 68, 76);
    const world = window.StationWorldSpec.resolve(config.id);
    const width = world.platformWidth;
    const activeTrackCenterZ = world.operatingTrackCenterZ;
    const centerZ = world.activePlatformCenterZ;
    const nearEdgeZ = centerZ - width / 2;
    const stair = config.stairs?.[0] || { positionRatio: 0.36, widthM: 3.2, runM: 8 };
    return Object.freeze({
      sceneLength: length,
      sceneWidth: width,
      platformEdgeZ: nearEdgeZ,
      activeTrackCenterZ,
      centerZ,
      stairCenterX: -length / 2 + length * Number(stair.positionRatio || 0.36),
      stairCenterZ: centerZ + width * 0.13,
      stairOpeningLength: clamp(Number(stair.runM || 8), 7.4, 9.0),
      stairOpeningWidth: clamp(Number(stair.widthM || 3.2) + 0.45, 3.45, 4.0),
      canopyZ: centerZ + width * 0.28,
      canopyLength: length * Number(config.roof?.coverageRatio || 0.58),
      canopyWidth: clamp(Number(config.roof?.widthM || 5.6) * 0.34, 1.65, 2.15),
      canopyHeight: Number(config.roof?.heightM || 5.7),
      world
    });
  };
})();
