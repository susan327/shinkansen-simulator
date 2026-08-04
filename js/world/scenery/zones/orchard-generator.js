"use strict";
ATCSceneryEngine.register(ctx=>ctx.zones
  .filter(z=>z.biome==="orchard")
  .forEach(z=>ctx.addOrchardZone(ctx.parent,z.startM,z.endM,z.density,z.variant)));
