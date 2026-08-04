"use strict";
/**
 * 駅構造物の断面寸法だけを管理する。
 * 線路・ホームの設計値は StationWorldSpec から受け取り、
 * 高架床・外側防音壁の位置を派生計算する。描画は行わない。
 */
(() => {
  function resolve(stationId = "asahigaoka") {
    const world = window.StationWorldSpec?.resolve(stationId);
    if (!world) throw new Error("StationStructureSpec requires StationWorldSpec.");

    const ballastHalfWidth = 2.15;
    const outsideClearance = 0.85;
    const trackMin = Math.min(...world.trackCenters);
    const trackMax = Math.max(...world.trackCenters);
    const leftWallZ = trackMin - ballastHalfWidth - outsideClearance;
    const rightWallZ = trackMax + ballastHalfWidth + outsideClearance;
    const deckMargin = 0.45;
    const deckMinZ = leftWallZ - deckMargin;
    const deckMaxZ = rightWallZ + deckMargin;

    return Object.freeze({
      stationId,
      ballastHalfWidth,
      outsideClearance,
      deck: Object.freeze({
        centerZ: (deckMinZ + deckMaxZ) / 2,
        width: deckMaxZ - deckMinZ,
        topBelowRail: 0.58,
        thickness: 0.52
      }),
      walls: Object.freeze({
        leftZ: leftWallZ,
        rightZ: rightWallZ,
        height: 2.10,
        thickness: 0.28,
        centerAboveRail: 0.96
      })
    });
  }

  window.StationStructureSpec = Object.freeze({
    version: "74.0.0-beta11",
    resolve
  });
})();
