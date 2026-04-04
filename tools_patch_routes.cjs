const fs = require("fs");
const p = "d:/googleplay/steamgame/steamGame/server/src/routes/index.ts";
let t = fs.readFileSync(p, "utf8");
if (!t.includes("steamV1Router")) {
  t = t.replace(
    "import { eventsRouter } from '../modules/events/events.routes';\r\n",
    "import { eventsRouter } from '../modules/events/events.routes';\r\nimport { steamV1Router } from '../modules/steam/steam.v1.routes';\r\n"
  );
  if (!t.includes("steamV1Router")) {
    t = t.replace(
      "import { eventsRouter } from '../modules/events/events.routes';\n",
      "import { eventsRouter } from '../modules/events/events.routes';\nimport { steamV1Router } from '../modules/steam/steam.v1.routes';\n"
    );
  }
  t = t.replace(
    "  v1.use('/events', eventsRouter(env));\r\n  r.use('/v1', v1);",
    "  v1.use('/events', eventsRouter(env));\r\n  v1.use('/steam', steamV1Router(env));\r\n  r.use('/v1', v1);"
  );
  if (!t.includes("v1.use('/steam'")) {
    t = t.replace(
      "  v1.use('/events', eventsRouter(env));\n  r.use('/v1', v1);",
      "  v1.use('/events', eventsRouter(env));\n  v1.use('/steam', steamV1Router(env));\n  r.use('/v1', v1);"
    );
  }
  fs.writeFileSync(p, t);
}
