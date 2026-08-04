"use strict";
/**
 * 駅の線路トポロジーだけを管理する。
 * 車両寸法・車体形状・材質は一切扱わない。
 */
(() => {
  const ref = window.TrainReferenceSpec;
  if (!ref) throw new Error("TrainReferenceSpec must load before StationTrackLayoutSpec.");

  const layouts = Object.freeze({
    "two-island-four-track": Object.freeze({
      trackCount: 4,
      islandPlatformCount: 2,
      trackPitch: 4.60,
      platformWidth: ref.platform.islandMinWidth,
      operatingTrackIndex: 0
    }),
    "side-four-track": Object.freeze({
      trackCount: 4,
      islandPlatformCount: 0,
      sidePlatformCount: 2,
      trackPitch: 4.60,
      platformWidth: ref.platform.sideMinWidth,
      operatingTrackIndex: 0
    }),
    "side-two-track": Object.freeze({
      trackCount: 2,
      islandPlatformCount: 0,
      sidePlatformCount: 2,
      trackPitch: 4.60,
      platformWidth: ref.platform.sideMinWidth,
      operatingTrackIndex: 0
    })
  });

  function get(type) {
    return layouts[type] || layouts["side-two-track"];
  }

  window.StationTrackLayoutSpec = Object.freeze({ version: ref.version, layouts, get });
})();
