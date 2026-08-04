"use strict";
window.ATCRoadbedRenderer = (()=>{
 const handlers=new Map();
 return Object.freeze({register(type,fn){handlers.set(type,fn);},render(type,ctx){const fn=handlers.get(type)||handlers.get("ground");if(fn)fn(ctx);},types(){return [...handlers.keys()];}});
})();
