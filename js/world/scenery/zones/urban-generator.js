"use strict";
ATCSceneryEngine.register(ctx=>ctx.zones.filter(z=>z.biome==="urban"||z.biome==="suburban").forEach(z=>ctx.addUrbanZone(ctx.parent,z.startM,z.endM,z.density)));
