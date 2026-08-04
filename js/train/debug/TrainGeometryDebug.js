"use strict";
(() => {
  window.TrainGeometryDebug = Object.freeze({
    describe() {
      const s = window.TrainGeometrySpec;
      return s ? {
        version: s.version,
        cars: s.formation.map(c => ({ ...c })),
        formationLength: s.formationLength,
        roofTopY: s.roofTopY,
        platformTopY: s.platformTopY,
        floorY: s.floorY
      } : null;
    }
  });
})();
