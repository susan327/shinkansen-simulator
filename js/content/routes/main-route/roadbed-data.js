"use strict";
window.ATC_ROADBED_SECTIONS = Object.freeze([
  Object.freeze({startM:0,endM:6500,type:"viaduct",label:"都市高架"}),
  Object.freeze({startM:6500,endM:12000,type:"ground",label:"郊外地平"}),
  Object.freeze({startM:12000,endM:18000,type:"embankment",label:"田園盛土",heightM:4.8}),
  Object.freeze({startM:18000,endM:22500,type:"ground",label:"桜野地平"}),
  Object.freeze({startM:22500,endM:25500,type:"bridge",label:"河川橋梁"}),
  Object.freeze({startM:25500,endM:29200,type:"cutting",label:"丘陵切土",depthM:4.5,wallType:"mixed"}),
  Object.freeze({startM:29200,endM:33800,type:"embankment",label:"青峰盛土",heightM:5.5}),
  Object.freeze({startM:33800,endM:36000,type:"cutting",label:"山間切土",depthM:6.2,wallType:"rock"}),
  Object.freeze({startM:36000,endM:42000,type:"tunnel",label:"山岳トンネル"}),
  Object.freeze({startM:42000,endM:45500,type:"ground",label:"田園地平"}),
  Object.freeze({startM:45500,endM:48500,type:"viaduct",label:"工業高架"}),
  Object.freeze({startM:48500,endM:52350,type:"viaduct",label:"海沿い都市高架"})
]);
window.ATC_ROADBED_SETTINGS = Object.freeze({
  ground:Object.freeze({formationWidthM:12.4,terrainWidthM:86,ditchOffsetM:7.0,fenceOffsetM:8.2}),
  embankment:Object.freeze({topWidthM:15.5,slopeWidthM:9.5,heightM:5.2,terrainWidthM:92}),
  cutting:Object.freeze({formationWidthM:13.0,bottomShoulderM:3.0,depthM:5.0,slopeWidthM:10.5,wallType:"mixed"}),
  viaduct:Object.freeze({deckWidthM:13.2,stationDeckWidthM:48,wallOffsetM:6.25,pierIntervalM:48,barrierHeightM:2.1}),
  bridge:Object.freeze({deckWidthM:13.2,wallOffsetM:6.25,pierIntervalM:90,barrierHeightM:1.65}),
  tunnel:Object.freeze({innerWidthM:12.6,innerHeightM:7.7,wallThicknessM:.65,lampIntervalM:110})
});
