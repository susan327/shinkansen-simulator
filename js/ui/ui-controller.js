"use strict";

/**
 * v71.3.0 UI public facade.
 * Responsibility: translate external UI requests into simulation-core commands.
 * No physics, ATC calculation, rendering, or station-state ownership lives here.
 */
window.ATCUIController = Object.freeze({
  refresh() { if (typeof updateDisplay === "function") updateDisplay(); },
  setRate(rate) { if (typeof setSimulationRate === "function") setSimulationRate(rate); },
  operateDoors() { if (typeof operateStationDoors === "function") operateStationDoors(); },
  skipBoarding() { if (typeof skipPassengerBoarding === "function") skipPassengerBoarding(); },
  reset() { if (typeof resetSimulation === "function") resetSimulation(); }
});
