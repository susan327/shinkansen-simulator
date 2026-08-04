"use strict";

/** 駅別カメラ設定を、編成方向を考慮した位置・注視点へ変換する。 */
(() => {
  window.ATC_resolveBoardingCamera = function resolveBoardingCamera(config, layout, THREERef) {
    const c = config.camera || {};
    const directionRight = config.direction !== "left";
    const targetX = -layout.sceneLength / 2 + layout.sceneLength * Number(c.targetRatio || 0.7);
    // 左後方・低めから右側先頭車を捉える。屋根より少し下の視線で側面を見せる。
    const position = new THREERef.Vector3(
      targetX - Number(c.distanceM || 34) * 0.78,
      Number(c.heightM || 4.8),
      Number(c.lateralM || 18)
    );
    const target = new THREERef.Vector3(
      directionRight ? targetX + 10.5 : targetX - 10.5,
      1.72,
      layout.platformEdgeZ - 0.45
    );
    return Object.freeze({ position, target, fov: Number(c.fov || 51), driftM: Number(c.driftM || 0.12) });
  };
})();
