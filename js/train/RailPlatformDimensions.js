"use strict";
/** 互換ファサード。固定値の決定権は TrainReferenceSpec のみ。 */
(() => {
  const ref = window.TrainReferenceSpec;
  if (!ref) throw new Error("TrainReferenceSpec must load before RailPlatformDimensions.");
  window.RailPlatformDimensions = Object.freeze({
    gauge: ref.rail.gauge,
    vehicleWidth: ref.body.width,
    vehicleHalfWidth: ref.body.width / 2,
    vehicleRoofHeightAboveRail: ref.body.roofTopY - ref.rail.railTopY,
    noseFrontMaxHeightAboveRail: ref.body.noseFrontTopY - ref.rail.railTopY,
    passengerFloorHeightAboveRail: ref.body.floorY - ref.rail.railTopY,
    platformTopHeightAboveRail: ref.platform.topY - ref.rail.railTopY,
    floorToPlatformDelta: ref.body.floorY - ref.platform.topY,
    platformEdgeFromTrackCenter: ref.platform.edgeFromTrackCenter,
    passingPlatformEdgeFromTrackCenter: ref.platform.passingEdgeFromTrackCenter,
    platformGap: ref.platform.gap,
    sidePlatformMinWidth: ref.platform.sideMinWidth,
    islandPlatformMinWidth: ref.platform.islandMinWidth,
    yellowLineInset: ref.platform.yellowLineInset,
    platformTopY: ref.platform.topY,
    roofTopY: ref.body.roofTopY,
    noseFrontTopY: ref.body.noseFrontTopY,
    passengerFloorY: ref.body.floorY,
    sidePlatformWidth: ref.platform.sideMinWidth,
    islandPlatformWidth: ref.platform.islandMinWidth
  });
})();
