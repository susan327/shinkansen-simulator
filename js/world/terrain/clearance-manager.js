"use strict";
window.ATCClearanceManager=Object.freeze({
 minTrackClearanceM:18,
 requiredLateral(objectRadiusM=0,extraM=0){return this.minTrackClearanceM+objectRadiusM+extraM;},
 safeLateral(lateralM,objectRadiusM=0,extraM=0){const min=this.requiredLateral(objectRadiusM,extraM);return Math.sign(lateralM||1)*Math.max(Math.abs(lateralM),min);}
});
