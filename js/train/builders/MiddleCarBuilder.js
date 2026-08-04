"use strict";
(() => {
  window.MiddleCarBuilder = Object.freeze({
    build({ THREE, parent, axis, d, mats, index, carNumber, serviceProfile, doorsOpen, platformSide, detailLevel }) {
      const shellLength = d.carLength - 0.10;
      window.TrainBodyPart.build({ THREE, parent, axis, d, mats, shellLength, shellCenter: 0 });
      window.TrainRoofPart.build({ THREE, parent, axis, d, mats, shellLength, shellCenter: 0 });
      window.TrainSkirtPart.build({ THREE, parent, axis, d, mats, shellLength, shellCenter: 0 });
      window.UnderbodyShieldBuilder.build({ THREE, parent, axis, d, mats, shellLength, shellCenter: 0, lead: false, noseDirection: 0 });
      const doors = window.TrainDoorsPart.build({ THREE, parent, axis, d, mats, index, noseDirection: 0, doorsOpen, platformSide });
      window.TrainWindowsPart.build({ THREE, parent, axis, d, mats, type: "middle", noseDirection: 0, serviceProfile, carNumber });
      if (detailLevel !== "low") {
        window.TrainBogiePart.build({ THREE, parent, axis, d, mats });
        window.TrainUnderfloorPart.build({ THREE, parent, axis, d, mats, index });
        window.TrainPantographPart.build({ THREE, parent, axis, d, mats, index });
      }
      parent.userData = { ...parent.userData, carIndex: index, carType: "middle", carNumber, serviceProfile, doors, underbodyShielded: true };
      return doors;
    }
  });
})();
