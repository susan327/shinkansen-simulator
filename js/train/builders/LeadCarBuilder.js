"use strict";
(() => {
  window.LeadCarBuilder = Object.freeze({
    build(options) {
      if (!window.TrainLeadCarPart) throw new Error("TrainLeadCarPart is not loaded.");
      return window.TrainLeadCarPart.buildLead(options);
    }
  });
})();
