"use strict";

/** 共通駅システムの公開窓口。 */
(() => {
  window.ATC_BOARDING_SCENE_SYSTEM = Object.freeze({
    version: "72.1.0",
    getConfig(stationId = "asahigaoka") {
      return window.ATC_getStationConfig(stationId);
    },
    getLayout(stationId = "asahigaoka") {
      const config = this.getConfig(stationId);
      return window.ATC_buildPlatformLayout(config, window.THREE);
    },
    describe(stationId = "asahigaoka") {
      const config = this.getConfig(stationId);
      const layout = this.getLayout(stationId);
      return { stationId, config, layout, consist: window.ATC_BOARDING_CONSIST_SPEC };
    }
  });
})();
