"use strict";
window.ATCRoadbedEngine = (()=>{
  const sections=window.ATC_ROADBED_SECTIONS||[];
  const settings=window.ATC_ROADBED_SETTINGS||{};
  function at(m){return sections.find(s=>m>=s.startM&&m<s.endM)||sections[sections.length-1]||{type:"ground"};}
  return Object.freeze({sections,settings,at});
})();
