import IORedis from "ioredis";

import { queueEnv } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __grievanceRedis: IORedis | undefined;
}

export const getRedis = (): IORedis => {
  if (!global.__grievanceRedis) {
    global.__grievanceRedis = new IORedis(queueEnv.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }

  return global.__grievanceRedis;
};
