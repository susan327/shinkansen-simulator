"use strict";

/**
 * v68 共通設定
 * 実寸値と見た目調整値をここへ集約する。
 * 駅や路線を延伸するときも、寸法定義は原則このファイルだけを編集する。
 */
const REAL_SECTION = window.RailPlatformDimensions || {};
window.ATC_CONFIG = Object.freeze({
  real: Object.freeze({
    gaugeM: REAL_SECTION.gauge || 1.435,
    vehicleWidthM: REAL_SECTION.vehicleWidth || 3.36,
    vehicleLengthM: 25.0,
    cars: window.TrainGeometrySpec?.carCount ?? 4,
    formationLengthM: window.TrainGeometrySpec?.formationLength ?? 107.4,
    platformGapM: REAL_SECTION.platformGap || 0.08
  }),
  visual: Object.freeze({
    islandPlatformWidthM: REAL_SECTION.islandPlatformMinWidth || 9.0,
    sidePlatformWidthM: REAL_SECTION.sidePlatformMinWidth || 5.0,
    yellowLineInsetM: REAL_SECTION.yellowLineInset || 0.80,
    roofWidthM: 10.0,
    columnCenterOffsetM: 2.8,
    parallelTrackSpacingM: 4.80,
    cameraFovDeg: 68,
    cameraHeightM: 2.75,
    defaultStructureType: "viaduct"
  }),
  game: Object.freeze({
    routeLengthM: 52350,
    platformLengthM: 424,
    boardingSeconds: 40,
    departureSwitchStartM: 24,
    departureSwitchEndM: 440,
    departureRearClearanceMarginM: 20
  })
});
