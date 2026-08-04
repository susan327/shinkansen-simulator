"use strict";
(() => {
  window.TailCarBuilder = Object.freeze({
    build(options) {
      if (!window.TrainLeadCarPart) throw new Error("TrainLeadCarPart is not loaded.");
      return window.TrainLeadCarPart.buildTail(options);
    }
  });
})();
