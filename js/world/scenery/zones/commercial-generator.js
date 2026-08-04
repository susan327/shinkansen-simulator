"use strict";
ATCSceneryEngine.register(ctx=>ctx.zones
  .filter(z=>z.biome==="commercial")
  .forEach(z=>ctx.addCommercialZone(ctx.parent,z.startM,z.endM,z.density,z.variant)));
