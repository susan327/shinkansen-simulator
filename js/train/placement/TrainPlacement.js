"use strict";
/** 車両形状に触れず、編成の位置・向きだけを管理する。 */
(() => {
  function placeStatic(modelOrGroup, { x = 0, y = 0, z = 0, rotationY = 0 } = {}) {
    const group = modelOrGroup.group || modelOrGroup;
    group.position.set(x, y, z); group.rotation.set(0, rotationY, 0);
    return group;
  }
  function assignRouteOffsets(model) {
    model.cars.forEach((car, i) => {
      const center = model.carDimensions?.[i]?.center ?? 0;
      car.userData.routeOffsetM = Math.abs(center);
    });
    return model;
  }
  function placeAlongRoute(group, { frontMeters, lateral, reverseDirection = false, bob = 0, routePose, routeLength = Infinity, originOffsetY = 0 }) {
    if (typeof routePose !== "function") throw new Error("TrainPlacement.placeAlongRoute requires routePose.");
    for (const car of group.userData.cars || []) {
      const offset = car.userData.routeOffsetM || 0;
      const carMeters = reverseDirection ? frontMeters + offset : frontMeters - offset;
      const p = routePose(carMeters, lateral);
      car.position.set(p.x, p.y + originOffsetY + bob, p.z);
      car.rotation.y = p.yaw + (reverseDirection ? 0 : Math.PI);
      car.rotation.x = reverseDirection ? -p.pitch : p.pitch;
      car.visible = carMeters >= 0 && carMeters <= routeLength;
    }
    group.position.set(0, 0, 0); group.rotation.set(0, 0, 0);
    return group;
  }
  window.TrainPlacement = Object.freeze({ placeStatic, assignRouteOffsets, placeAlongRoute });
})();
