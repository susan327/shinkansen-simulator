"use strict";
ATCSceneryEngine.register(ctx=>ctx.zones.filter(z=>z.biome==="coast").forEach(z=>ctx.addCoastZone(ctx.parent,z.startM,z.endM,z.density)));
