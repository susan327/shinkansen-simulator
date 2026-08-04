"use strict";
/** 乗降演出固有の設定だけを持つ。編成長・車両数は TrainConsistSpec から参照する。 */
(() => {
  const consist = window.TrainConsistSpec;
  if (!consist) throw new Error("TrainConsistSpec must load before boarding consist adapter.");
  window.ATC_BOARDING_CONSIST_SPEC = Object.freeze({
    direction: "right",
    displayCarCount: consist.cars.length,
    doorInsetM: 1.7,
    doorType: "single-slide",
    doorWidth: 1.14,
    leadSide: "right",
    rearSide: "left"
  });
})();
