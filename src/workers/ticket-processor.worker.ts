import { Worker } from "bullmq";

import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { TICKET_PROCESSING_QUEUE, TicketProcessingJob } from "../lib/queue";
import { getRedis } from "../lib/redis";
import { processTicketJob } from "../lib/ticket-processing";

export const ticketProcessingWorker = new Worker<TicketProcessingJob>(
  TICKET_PROCESSING_QUEUE,
  processTicketJob,
  {
    connection: getRedis() as unknown as import("bullmq").ConnectionOptions,
    concurrency: 8,
  },
);

ticketProcessingWorker.on("completed", (job) => {
  logger.info(
    {
      jobId: job.id,
      merchantId: job.data.merchantId,
      ticketId: job.data.ticketId,
    },
    "Ticket processing job completed",
  );
});

ticketProcessingWorker.on("failed", (job, error) => {
  logger.error(
    {
      error,
      jobId: job?.id,
      merchantId: job?.data.merchantId,
      ticketId: job?.data.ticketId,
    },
    "Ticket processing job failed",
  );
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutting down ticket processing worker");
  await ticketProcessingWorker.close();
  await prisma.$disconnect();
  await getRedis().quit();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
