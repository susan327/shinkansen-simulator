"use strict";
/** 車体断面の読み取り専用Spec。固定値決定元は TrainReferenceSpec。 */
(() => {
  const ref = window.TrainReferenceSpec;
  if (!ref) throw new Error("TrainReferenceSpec must load before BodyProfileSpec.");
  window.BodyProfileSpec = Object.freeze({
    width: ref.body.width,
    floorY: ref.body.floorY,
    bodyBottomY: ref.body.bodyBottomY,
    roofTopY: ref.body.roofTopY,
    noseFrontTopY: ref.body.noseFrontTopY,
    skirtShoulderY: ref.body.skirtShoulderY,
    skirtBottomY: ref.body.skirtBottomY,
    skirtTopWidth: ref.body.width,
    skirtBottomWidth: ref.body.skirtBottomWidth,
    underbodyWidth: ref.body.underbodyWidth
  });
})();
