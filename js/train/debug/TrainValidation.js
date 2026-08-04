"use strict";
/** 開発時に責任重複・寸法不整合を早期検出する。 */
(() => {
  const EPS = 1e-6;
  const close = (a, b) => Math.abs(a - b) <= EPS;

  function validate({ throwOnError = false } = {}) {
    const ref = window.TrainReferenceSpec;
    const geo = window.TrainGeometrySpec;
    const dims = window.TrainDimensions;
    const errors = [];
    if (!ref) errors.push("TrainReferenceSpec is missing.");
    if (!geo) errors.push("TrainGeometrySpec is missing.");
    if (!dims) errors.push("TrainDimensions is missing.");
    if (ref && geo) {
      if (!close(geo.carWidth, ref.body.width)) errors.push("Car width mismatch.");
      if (!close(geo.roofTopY, ref.body.roofTopY)) errors.push("Roof height mismatch.");
      if (!close(geo.floorY, ref.body.floorY)) errors.push("Floor height mismatch.");
      if (!close(geo.gauge, ref.rail.gauge)) errors.push("Gauge mismatch.");
      if (!close(geo.platformGap, ref.platform.gap)) errors.push("Platform gap mismatch.");
    }
    if (geo && dims) {
      if (!close(dims.roofTopY, geo.roofTopY)) errors.push("TrainDimensions roof mismatch.");
      if (!close(dims.wheelCenterY, geo.wheelCenterY)) errors.push("Wheel center mismatch.");
    }
    const result = Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
    if (!result.ok && throwOnError) throw new Error(`Train validation failed: ${errors.join(" ")}`);
    return result;
  }

  window.TrainValidation = Object.freeze({ validate });
})();
