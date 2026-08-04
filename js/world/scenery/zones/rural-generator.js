"use strict";
ATCSceneryEngine.register(ctx=>ctx.zones.filter(z=>z.biome==="rural").forEach(z=>ctx.addFieldZone(ctx.parent,z.startM,z.endM)));
