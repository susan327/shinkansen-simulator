"use strict";
ATCSceneryEngine.register(ctx=>ctx.zones.filter(z=>z.biome==="industrial").forEach(z=>ctx.addIndustrialZone(ctx.parent,z.startM,z.endM,z.density)));
