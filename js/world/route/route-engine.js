"use strict";

/**
 * 路線座標API。
 * Three.jsのSplineが用意された後に attachSpline() すると、距離と横オフセットから座標を得られる。
 */
window.ATCRouteEngine = (() => {
  let spline = null;
  let lengthM = window.ATC_CONFIG.game.routeLengthM;

  function attachSpline(nextSpline, nextLengthM = lengthM) {
    spline = nextSpline;
    lengthM = nextLengthM;
  }

  function getFrame(distanceM) {
    if (!spline) return null;
    const t = Math.max(0, Math.min(1, distanceM / lengthM));
    const center = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    return { center, tangent, normal, t };
  }

  function getOffsetPosition(distanceM, lateralM = 0) {
    const frame = getFrame(distanceM);
    return frame ? frame.center.clone().addScaledVector(frame.normal, lateralM) : null;
  }

  return Object.freeze({ attachSpline, getFrame, getOffsetPosition });
})();
