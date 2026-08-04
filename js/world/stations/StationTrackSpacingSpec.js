"use strict";
/**
 * 駅構内の横方向寸法だけを管理する。
 * 島式ホームを挟む本線-待避線間隔は、ホーム幅と縁端離隔から必ず算出する。
 * 描画・車両・カメラは扱わない。
 */
(() => {
  const DEFAULTS = Object.freeze({
    mainToMain: 5.00,
    sideMainToSiding: 4.80,
    trackToPlatformEdge: 1.76,
    passengerEdgeBuffer: 0.60
  });

  function resolve(stationId = "asahigaoka") {
    const station = window.ATC_getStationConfig?.(stationId);
    const ref = window.TrainReferenceSpec;
    if (!station || !ref) {
      throw new Error("StationTrackSpacingSpec requires station config and TrainReferenceSpec.");
    }

    const mainToMain = Number(station.trackSpacing?.mainToMain ?? DEFAULTS.mainToMain);
    const mainHalf = mainToMain / 2;
    const trackToPlatformEdge = Number(
      station.trackSpacing?.trackToPlatformEdge
      ?? ref.platform.trackCenterToEdge
      ?? DEFAULTS.trackToPlatformEdge
    );
    const platformWidth = Number(
      station.platformWidthM
      || (station.platformType === "two-island-four-track"
        ? ref.platform.islandMinWidth
        : ref.platform.sideMinWidth)
    );

    // 島式ホームの両側に線路がある場合、この関係は幾何学的に一意。
    // 駅個別の mainToSiding 固定値で上書きするとホームと線路が重なるため禁止する。
    const derivedIslandMainToSiding = platformWidth + 2 * trackToPlatformEdge;
    const mainToSiding = station.platformType === "two-island-four-track"
      ? derivedIslandMainToSiding
      : Number(station.trackSpacing?.mainToSiding ?? DEFAULTS.sideMainToSiding);

    const mainLeft = -mainHalf;
    const mainRight = mainHalf;
    const leftOuter = mainLeft - mainToSiding;
    const rightOuter = mainRight + mainToSiding;

    return Object.freeze({
      mainToMain,
      mainToSiding,
      trackToPlatformEdge,
      platformWidth,
      mainLeft,
      mainRight,
      leftOuter,
      rightOuter,
      calculationMode: station.platformType === "two-island-four-track" ? "derived-from-platform" : "station-or-default",
      derivedIslandMainToSiding
    });
  }

  window.StationTrackSpacingSpec = Object.freeze({
    version: "74.0.0-beta11",
    defaults: DEFAULTS,
    resolve
  });
})();
