"use strict";
ATCSceneryEngine.register(ctx=>ctx.zones.filter(z=>z.biome==="river").forEach(z=>ctx.addRiverZone(ctx.parent,z.startM,z.endM)));
