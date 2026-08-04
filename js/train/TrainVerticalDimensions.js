"use strict";
/** 互換ファサード。縦方向の固定値は TrainReferenceSpec からのみ派生する。 */
(() => {
  const ref = window.TrainReferenceSpec;
  if (!ref) throw new Error("TrainReferenceSpec must load before TrainVerticalDimensions.");
  const railTopY = ref.rail.railTopY;
  const wheelCenterY = ref.wheel.centerY;
  window.TrainVerticalDimensions = Object.freeze({
    railTopY,
    wheelRadius: ref.wheel.radius,
    wheelCenterY,
    wheelBottomY: railTopY,
    wheelTopY: wheelCenterY + ref.wheel.radius,
    floorY: ref.body.floorY,
    passengerFloorHeightAboveRail: ref.body.floorY - railTopY,
    platformTopAboveRail: ref.platform.topY - railTopY,
    platformTopY: ref.platform.topY,
    floorToPlatformDelta: ref.body.floorY - ref.platform.topY,
    bodyBottomY: ref.body.bodyBottomY,
    bodyHeight: ref.body.sideWallTopY - ref.body.bodyBottomY,
    sideWallTopY: ref.body.sideWallTopY,
    roofHeight: ref.body.roofHeight,
    roofTopY: ref.body.roofTopY,
    noseFrontTopY: ref.body.noseFrontTopY,
    overallVehicleHeightAboveRail: ref.body.roofTopY - railTopY,
    wheelCenterToFloor: ref.body.floorY - wheelCenterY,
    wheelCenterToRoof: ref.body.roofTopY - wheelCenterY,
    skirtShoulderY: ref.body.skirtShoulderY,
    skirtBottomY: ref.body.skirtBottomY,
    leadSkirtBottomY: ref.body.leadSkirtBottomY,
    pantographBaseY: ref.body.roofTopY + 0.06,
    pantographTopY: ref.body.roofTopY + 1.10,
    routeRailTopOffsetY: ref.route.railTopOffsetY,
    routeTrainOriginOffsetY: ref.route.trainOriginOffsetY
  });
})();
