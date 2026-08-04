"use strict";

/**
 * 駅と路線の宣言データ。
 * 延伸時は stations 配列へ駅を追加し、routeLengthM を更新する。
 */
(() => {
  const C = window.ATC_CONFIG;
  const trackToPlatformEdgeM = C.real.vehicleWidthM / 2 + C.real.platformGapM;
  const islandTrackSpacingM = C.visual.islandPlatformWidthM + trackToPlatformEdgeM * 2;
  const defaultMainSpacingM = 5.0;
  const mainTrackCentersM = Object.freeze([-defaultMainSpacingM / 2, defaultMainSpacingM / 2]);
  // 島式2面4線: 内側線と外側線の間へ幅12mのホームを確保する。
  const outerSidingOffsetM = Math.abs(mainTrackCentersM[0]) + islandTrackSpacingM;
  const islandCenterOffsetM = (Math.abs(mainTrackCentersM[0]) + outerSidingOffsetM) / 2;
  // 相対式2面4線: 外側線は本線から通常の複線間隔だけ離す。
  const relativeOuterTrackOffsetM = Math.abs(mainTrackCentersM[0]) + C.visual.parallelTrackSpacingM;
  const sidePlatformWidthM = C.visual.sidePlatformWidthM;

  window.ATC_ROUTE_V675 = Object.freeze({
    version: "70.2",
    geometry: Object.freeze({
      gaugeM: C.real.gaugeM,
      carWidthM: C.real.vehicleWidthM,
      carHalfWidthM: C.real.vehicleWidthM / 2,
      platformGapM: C.real.platformGapM,
      platformWidthM: C.visual.islandPlatformWidthM,
      sidePlatformWidthM,
      yellowLineInsetM: C.visual.yellowLineInsetM,
      roofWidthM: C.visual.roofWidthM,
      columnCenterOffsetM: C.visual.columnCenterOffsetM,
      parallelTrackSpacingM: C.visual.parallelTrackSpacingM,
      mainTrackCentersM,
      trackToPlatformEdgeM,
      islandTrackSpacingM,
      outerSidingOffsetM,
      islandCenterOffsetM,
      relativeOuterTrackOffsetM
    }),
    stations: Object.freeze([
      Object.freeze({ id: "asahigaoka", name: "旭ヶ丘", markerM: 0, layout: "two-island-four-track", role: "origin", platformLengthM: 424, operatingTrack: "left-outer", platformEndM: 18, switchStartM: 24, switchEndM: 440 }),
      Object.freeze({ id: "sakurano", name: "桜野", markerM: 18000, layout: "side-four-track", role: "pass", speedKmh: 300, platformLengthM: 420 }),
      Object.freeze({ id: "aomine", name: "青峰", markerM: 32000, layout: "side-two-track", role: "pass", speedKmh: 170, platformLengthM: 420, curveThroughPlatform: true }),
      Object.freeze({ id: "shiomichuo", name: "潮見中央", markerM: 52000, layout: "two-island-four-track", role: "terminal", platformLengthM: 424, operatingTrack: "left-main", occupiedTrack: "left-outer" })
    ])
  });
})();
