"use strict";
/** 後方互換アダプター。生成実体を持たず、必ず共通描画入口へ委譲する。 */
(() => {
  function build(options = {}) {
    if (!window.TrainRenderAdapter) throw new Error("TrainRenderAdapter is not loaded.");
    return window.TrainRenderAdapter.create(options);
  }
  window.TrainBuilder = Object.freeze({ build });
})();
