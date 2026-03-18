import pino from "pino";

import { appEnv } from "./env";

export const logger = pino({
  level: appEnv.logLevel,
  base: undefined,
  messageKey: "message",
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
