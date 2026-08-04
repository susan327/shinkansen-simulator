"use strict";
ATCSceneryEngine.register(ctx=>ctx.zones
  .filter(z=>z.biome==="highway")
  .forEach(z=>ctx.addHighwayZone(ctx.parent,z.startM,z.endM,z.density,z.variant)));
