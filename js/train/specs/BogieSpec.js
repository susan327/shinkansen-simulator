"use strict";
/** 台車の読み取り専用Spec。寸法決定元は TrainReferenceSpec。 */
(() => {
  const ref = window.TrainReferenceSpec;
  if (!ref) throw new Error("TrainReferenceSpec must load before BogieSpec.");
  const common = Object.freeze({
    gauge: ref.rail.gauge,
    wheelRadius: ref.wheel.radius,
    wheelCenterY: ref.wheel.centerY,
    axleHalfSpacing: ref.wheel.axleHalfSpacing
  });
  window.BogieSpec = Object.freeze({
    common,
    lead: Object.freeze({ ...common, centerOffset: ref.bogies.lead.centerOffset }),
    middle: Object.freeze({ ...common, centerOffset: ref.bogies.middle.centerOffset }),
    tail: Object.freeze({ ...common, centerOffset: ref.bogies.tail.centerOffset })
  });
})();
