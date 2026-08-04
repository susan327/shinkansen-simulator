"use strict";
/** 編成構成の読み取り専用Spec。固定編成値は TrainReferenceSpec が唯一の決定元。 */
(() => {
  const ref = window.TrainReferenceSpec;
  if (!ref) throw new Error("TrainReferenceSpec must load before TrainConsistSpec.");
  const cars = ref.consist.cars;
  const carGap = ref.consist.carGap;
  const bodyLength = cars.reduce((sum, car) => sum + car.length, 0);
  const formationLength = bodyLength + carGap * Math.max(0, cars.length - 1);
  window.TrainConsistSpec = Object.freeze({ version: ref.version, cars, carGap, bodyLength, formationLength });
})();
