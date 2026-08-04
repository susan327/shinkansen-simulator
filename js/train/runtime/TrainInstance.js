"use strict";
/**
 * v74.2.0-alpha7
 * 停車・運転・対向・退避で共通利用する列車インスタンス。
 * 形状生成は行わず、共通モデルとシーン状態だけを保持する。
 */
(() => {
  const VALID_PURPOSES = new Set(["station", "running", "opposing", "siding", "debug"]);

  function normalizePurpose(value) {
    return VALID_PURPOSES.has(value) ? value : "running";
  }

  function create(model, options = {}) {
    if (!model?.group) throw new Error("TrainInstance requires a built train model.");
    const purpose = normalizePurpose(options.purpose);
    const state = {
      purpose,
      phase: options.phase || (purpose === "station" ? "stopped" : "running"),
      speedKmh: Number(options.speedKmh || 0),
      doorsOpen: Number(options.doorsOpen || 0),
      direction: options.direction === -1 ? -1 : 1,
      visible: options.visible !== false
    };

    const instance = {
      model,
      group: model.group,
      cars: model.cars,
      doors: model.doors,
      dimensions: model.dimensions,
      formationLength: model.formationLength,
      state,
      setPurpose(nextPurpose) {
        state.purpose = normalizePurpose(nextPurpose);
        instance.group.userData.trainPurpose = state.purpose;
        return instance;
      },
      setPhase(phase) {
        state.phase = String(phase || "");
        instance.group.userData.trainPhase = state.phase;
        return instance;
      },
      setSpeed(speedKmh) {
        state.speedKmh = Math.max(0, Number(speedKmh || 0));
        return instance;
      },
      setVisible(visible) {
        state.visible = Boolean(visible);
        instance.group.visible = state.visible;
        return instance;
      }
    };

    Object.assign(instance.group.userData, {
      trainInstance: instance,
      trainModel: model,
      trainPurpose: state.purpose,
      trainPhase: state.phase,
      renderPipeline: "TrainInstance>TrainRenderAdapter>TrainConsistBuilder",
      runtimeVersion: "74.2.0-alpha7"
    });
    instance.group.visible = state.visible;
    return instance;
  }

  window.TrainInstance = Object.freeze({ create, VALID_PURPOSES });
})();
