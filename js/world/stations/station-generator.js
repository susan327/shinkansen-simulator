"use strict";
/** 駅データ参照API。寸法はStationWorldSpecから取得する。 */
window.ATCStationGenerator=Object.freeze({
  getAll(){return window.ATC_ROUTE_V675.stations;},
  getById(id){return window.ATC_ROUTE_V675.stations.find(s=>s.id===id)||null;},
  getByRole(role){return window.ATC_ROUTE_V675.stations.filter(s=>s.role===role);},
  getWorld(id){return window.StationWorldSpec.resolve(id);},
  getPlatformEdges(stationId="asahigaoka",platformIndex=0){
    const p=window.StationWorldSpec.resolve(stationId).platforms[platformIndex];
    return Object.freeze({leftM:p.centerZ-p.width/2,rightM:p.centerZ+p.width/2});
  }
});
