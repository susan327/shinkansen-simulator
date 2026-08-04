"use strict";
/** 車両とホーム・レールの離隔だけを公開する読み取り専用Spec。 */
(() => {
  const ref = window.TrainReferenceSpec;
  if (!ref) throw new Error("TrainReferenceSpec must load before TrainClearanceSpec.");
  window.TrainClearanceSpec = Object.freeze({
    platformTopY: ref.platform.topY,
    platformEdgeFromTrackCenter: ref.platform.edgeFromTrackCenter,
    bodyHalfWidth: ref.body.width / 2,
    platformGap: ref.platform.gap,
    sidePlatformWidth: ref.platform.sideMinWidth,
    islandPlatformWidth: ref.platform.islandMinWidth,
    minimumRailClearance: ref.body.skirtBottomY - ref.rail.railTopY
  });
})();
