"use strict";

/** 線路寸法と中心位置の共通計算。描画実体は app.js の安定版処理から段階移行する。 */
window.ATCTrackGenerator = Object.freeze({
  getRailOffsets(trackCenterM) {
    const halfGauge = window.ATC_CONFIG.real.gaugeM / 2;
    return Object.freeze({ leftM: trackCenterM - halfGauge, rightM: trackCenterM + halfGauge });
  },
  getStationGeometry() {
    return window.ATC_ROUTE_V675.geometry;
  },
  validate() {
    const g = window.ATC_ROUTE_V675.geometry;
    const expected = g.platformWidthM + 2 * (g.carHalfWidthM + g.platformGapM);
    if (Math.abs(expected - g.islandTrackSpacingM) > 1e-6) {
      throw new Error("島式ホームと線路中心間隔の計算が一致していません。");
    }
    return true;
  }
});
