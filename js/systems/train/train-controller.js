"use strict";

/** 既存運転コアへの安全な公開窓口。 */
window.ATCTrainController = Object.freeze({
  getState() { return typeof train !== "undefined" ? train : null; },
  setPower(delta) { if (typeof changePower === "function") changePower(delta); },
  setBrake(delta) { if (typeof changeBrake === "function") changeBrake(delta); },
  neutral() { if (typeof setPowerNeutral === "function") setPowerNeutral(); },
  emergency() { if (typeof setEmergencyBrake === "function") setEmergencyBrake(); },
  reset() { if (typeof resetSimulation === "function") resetSimulation(); }
});
