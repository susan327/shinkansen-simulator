"use strict";
ATCSceneryEngine.register(ctx=>ctx.zones.filter(z=>z.biome==="hilly").forEach(z=>{ctx.addForestZone(ctx.parent,z.startM,z.endM);ctx.addHills(ctx.parent,z.startM,z.endM,.65);}));
