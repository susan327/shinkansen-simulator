"use strict";
/**
 * 停車・運転・対向・退避が共有する唯一の列車生成入口。
 * シーン側はこのアダプター以外から編成を生成しない。
 */
(() => {
  function createInstance(options = {}) {
    if (!window.TrainConsistBuilder) throw new Error("TrainConsistBuilder is not loaded.");
    if (!window.TrainInstance) throw new Error("TrainInstance is not loaded.");
    const purpose = options.purpose || "running";
    const model = window.TrainConsistBuilder.build(options);
    window.TrainPlacement?.assignRouteOffsets(model);
    const instance = window.TrainInstance.create(model, { ...options, purpose });
    model.group.userData.cars = model.cars;
    model.group.userData.renderAdapterVersion = "74.3.2-alpha10";
    return instance;
  }

  function forStation(options = {}) { return createInstance({ ...options, purpose: "station", phase: "stopped" }); }
  function forRunning(options = {}) { return createInstance({ ...options, purpose: "running", phase: "running" }); }
  function forOpposing(options = {}) { return createInstance({ ...options, purpose: "opposing", phase: "running" }); }
  function forSiding(options = {}) { return createInstance({ ...options, purpose: "siding", phase: "stopped" }); }

  // 後方互換: 旧コードには従来どおり model を返す。ただし生成経路は同じ。
  function create(options = {}) { return createInstance(options).model; }

  window.TrainRenderAdapter = Object.freeze({ createInstance, create, forStation, forRunning, forOpposing, forSiding });
})();
