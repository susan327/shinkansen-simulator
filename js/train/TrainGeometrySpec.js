"use strict";
/** 各Specを集約する読み取り専用ファサード。固定値は保持しない。 */
(() => {
  const ref = window.TrainReferenceSpec;
  const consist = window.TrainConsistSpec;
  const body = window.BodyProfileSpec;
  const bogies = window.BogieSpec;
  const clearance = window.TrainClearanceSpec;
  if (!ref || !consist || !body || !bogies || !clearance) {
    throw new Error("Train specs must load before TrainGeometrySpec.");
  }
  const formation = Object.freeze(consist.cars.map((car, index) => Object.freeze({
    index,
    id: car.id,
    carNumber: car.carNumber || index + 1,
    type: car.type,
    serviceProfile: car.serviceProfile || (car.type === "middle" ? ((index + 1) % 2 ? "facilities" : "passenger") : "cab"),
    length: car.length,
    bogieOffset: bogies[car.bogieProfile].centerOffset,
    bogieProfile: car.bogieProfile
  })));
  window.TrainGeometrySpec = Object.freeze({
    version: ref.version,
    coordinateSystem: ref.coordinateSystem,
    formation,
    carCount: formation.length,
    carGap: consist.carGap,
    bodyLength: consist.bodyLength,
    formationLength: consist.formationLength,
    gauge: ref.rail.gauge,
    carWidth: body.width,
    platformEdgeFromTrackCenter: clearance.platformEdgeFromTrackCenter,
    platformGap: clearance.platformGap,
    platformTopY: clearance.platformTopY,
    floorY: body.floorY,
    roofTopY: body.roofTopY,
    noseFrontTopY: body.noseFrontTopY,
    wheelRadius: bogies.common.wheelRadius,
    wheelCenterY: bogies.common.wheelCenterY,
    bodyBottomY: body.bodyBottomY,
    skirtShoulderY: body.skirtShoulderY,
    skirtBottomY: body.skirtBottomY,
    routeTrainOriginOffsetY: ref.route.trainOriginOffsetY
  });
})();
