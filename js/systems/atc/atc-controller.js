"use strict";

/** ATC状態の参照・確認操作API。 */
window.ATCController = Object.freeze({
  getPlan() { return typeof getAtcPlan === "function" ? getAtcPlan() : null; },
  confirm() { if (typeof confirmAtc30 === "function") confirmAtc30(); }
});
