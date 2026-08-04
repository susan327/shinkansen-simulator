"use strict";
/** v74.0.0-beta7: 編成配列駆動の唯一の車両生成実体。 */
(() => {
  const helpers = () => window.TrainPartHelpers;

  function dimensionsForCar(base, carSpec) {
    return {
      ...base,
      carLength: carSpec.length,
      bogieCenterOffset: carSpec.bogieOffset
    };
  }

  function buildCar({ THREE, axis, d, mats, carSpec, direction, doorsOpen, platformSide, detailLevel }) {
    const car = new THREE.Group();
    const common = { THREE, parent: car, axis, d, mats, index: carSpec.index, carNumber: carSpec.carNumber || carSpec.index + 1, serviceProfile: carSpec.serviceProfile, direction, doorsOpen, platformSide, detailLevel };
    let doors;
    if (carSpec.type === "lead") doors = window.LeadCarBuilder.build(common);
    else if (carSpec.type === "tail") doors = window.TailCarBuilder.build(common);
    else doors = window.MiddleCarBuilder.build(common);
    car.userData = { ...car.userData, carIndex: carSpec.index, carType: carSpec.type, carNumber: carSpec.carNumber || carSpec.index + 1, serviceProfile: carSpec.serviceProfile, doors: doors || car.userData.doors || [] };
    return car;
  }

  function build(options = {}) {
    const THREE = options.THREE || window.THREE;
    if (!THREE) throw new Error("TrainConsistBuilder requires THREE.");
    const spec = window.TrainGeometrySpec;
    if (!spec) throw new Error("TrainGeometrySpec is not loaded.");

    const formation = options.formation || spec.formation;
    const base = { ...window.TrainDimensions, carCount: formation.length };
    const axis = options.axis || "z";
    const direction = options.direction === -1 ? -1 : 1;
    const mats = window.TrainMaterials.create(THREE);
    const group = new THREE.Group();
    const cars = [], doors = [], carDimensions = [];
    let previousCenter = 0, previousLength = 0;

    formation.forEach((carSpec, i) => {
      const normalized = { ...carSpec, index: i };
      const d = dimensionsForCar(base, normalized);
      const center = i === 0 ? 0 : previousCenter - direction * (previousLength / 2 + spec.carGap + d.carLength / 2);
      const car = buildCar({ THREE, axis, d, mats, carSpec: normalized, direction,
        doorsOpen: options.doorsOpen || 0, platformSide: options.platformSide ?? 1,
        detailLevel: options.detailLevel || "full" });
      helpers().longitudinal(car, axis, center);
      group.add(car); cars.push(car); doors.push(...(car.userData.doors || []));
      carDimensions.push(Object.freeze({ index: i, type: normalized.type, carNumber: normalized.carNumber || i + 1, serviceProfile: normalized.serviceProfile, length: d.carLength, center }));
      previousCenter = center; previousLength = d.carLength;
    });

    const formationLength = formation.reduce((sum, c) => sum + c.length, 0) + spec.carGap * Math.max(0, formation.length - 1);
    Object.assign(group.userData, { cars, doors, dimensions: base, carDimensions, formationLength,
      carCount: formation.length, axis, direction, trainBuilderVersion: "74.2.0-alpha7" });
    return { group, cars, doors, materials: mats, dimensions: base, carDimensions, formationLength };
  }

  window.TrainConsistBuilder = Object.freeze({ build });
})();
