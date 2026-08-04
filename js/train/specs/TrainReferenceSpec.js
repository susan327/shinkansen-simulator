"use strict";
/**
 * v74.0.0-beta4
 * 車両・軌道・ホーム断面に関する唯一の固定値定義。
 * このファイル以外で実寸値を直接決めない。
 */
(() => {
  const railTopY = 0.0;
  const gauge = 1.435;
  const wheelRadius = 0.43;
  const vehicleWidth = 3.36;
  const platformEdgeFromTrackCenter = 1.76;
  const passengerFloorY = 1.30;
  const platformTopY = 1.25;
  const roofTopY = 3.60;
  const sideWallTopY = 3.20;
  const bodyBottomY = 0.45;

  window.TrainReferenceSpec = Object.freeze({
    version: "74.2.0-alpha7",
    coordinateSystem: Object.freeze({ railTopY, trackCenterZ: 0.0, carCenterX: 0.0 }),
    rail: Object.freeze({ gauge, railTopY }),
    wheel: Object.freeze({
      radius: wheelRadius,
      centerY: railTopY + wheelRadius,
      axleHalfSpacing: 0.79
    }),
    body: Object.freeze({
      width: vehicleWidth,
      bodyBottomY,
      sideWallTopY,
      roofTopY,
      roofHeight: roofTopY - sideWallTopY,
      floorY: passengerFloorY,
      noseFrontTopY: 3.50,
      skirtShoulderY: 1.22,
      skirtBottomY: 0.08,
      leadSkirtBottomY: 0.06,
      skirtBottomWidth: 2.14,
      underbodyWidth: 1.84
    }),
    platform: Object.freeze({
      topY: platformTopY,
      edgeFromTrackCenter: platformEdgeFromTrackCenter,
      passingEdgeFromTrackCenter: 1.80,
      gap: platformEdgeFromTrackCenter - vehicleWidth / 2,
      sideMinWidth: 5.00,
      islandMinWidth: 9.00,
      yellowLineInset: 0.80
    }),
    consist: Object.freeze({
      carGap: 0.80,
      cars: Object.freeze([
        Object.freeze({ id: "car-1", carNumber: 1, type: "lead", serviceProfile: "cab", length: 27.5, bogieProfile: "lead" }),
        Object.freeze({ id: "car-2", carNumber: 2, type: "middle", serviceProfile: "passenger", length: 25.0, bogieProfile: "middle" }),
        Object.freeze({ id: "car-3", carNumber: 3, type: "middle", serviceProfile: "facilities", length: 25.0, bogieProfile: "middle" }),
        Object.freeze({ id: "car-4", carNumber: 4, type: "tail", serviceProfile: "cab", length: 27.5, bogieProfile: "tail" })
      ])
    }),
    bogies: Object.freeze({
      lead: Object.freeze({ centerOffset: 7.85 }),
      middle: Object.freeze({ centerOffset: 8.55 }),
      tail: Object.freeze({ centerOffset: 7.85 })
    }),
    details: Object.freeze({
      noseLength: 12.0,
      doorWidth: 1.02,
      doorHeight: 1.86,
      windowWidth: 0.82,
      windowHeight: 0.46,
      windowCenterY: 2.38,
      stripePrimaryY: 1.96,
      stripeSecondaryY: 1.78,
      windowPitch: 1.36,
      pillarWidth: 0.18,
      stripeSurfaceOffset: 0.006,
      leadStripeFadeStartDoorInset: 1.25,
      leadStripeFadeEndFromTip: 5.55,
      leadStripeTaperLength: 5.8,
      leadStripeTipClearance: 2.4,
      leadBellyCoverTopY: 1.02,
      leadBellyCoverBottomY: 0.12
    }),
    route: Object.freeze({
      railTopOffsetY: 0.33,
      trainOriginOffsetY: 0.33 - railTopY
    })
  });
})();
