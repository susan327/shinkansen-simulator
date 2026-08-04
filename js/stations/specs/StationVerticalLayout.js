"use strict";
/**
 * v74.0.0-beta6
 * 停車シーンの世界Y座標を一元管理する。
 * レール頭頂面をY=0とし、ホーム・車両・乗客・駅設備を同じ基準で配置する。
 */
(() => {
  const ref = window.TrainReferenceSpec;
  if (!ref) throw new Error("TrainReferenceSpec must load before StationVerticalLayout.");

  const railTopY = ref.rail.railTopY;
  const platformTopY = ref.platform.topY;
  const passengerFloorY = ref.body.floorY;
  const platformSlabThickness = 0.50;
  const legacyPlatformTopY = 0.05;
  const legacyShiftY = platformTopY - legacyPlatformTopY;

  const fromLegacyPlatformSceneY = y => y + legacyShiftY;
  const platformRelativeY = y => platformTopY + y;

  window.StationVerticalLayout = Object.freeze({
    railTopY,
    platformTopY,
    passengerFloorY,
    floorToPlatformDelta: passengerFloorY - platformTopY,
    trainOriginY: railTopY,
    platformSlabThickness,
    platformSlabCenterY: platformTopY - platformSlabThickness / 2,
    legacyPlatformTopY,
    legacyShiftY,
    fromLegacyPlatformSceneY,
    platformRelativeY
  });
})();
