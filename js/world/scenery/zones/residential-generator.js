"use strict";
ATCSceneryEngine.register(ctx=>ctx.zones
  .filter(z=>z.biome==="residential")
  .forEach(z=>ctx.addResidentialZone(ctx.parent,z.startM,z.endM,z.density,z.variant)));
