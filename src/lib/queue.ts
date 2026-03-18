import { JobsOptions, Queue } from "bullmq";
import type { ConnectionOptions, Job } from "bullmq";

import { getRedis } from "./redis";

export const TICKET_PROCESSING_QUEUE = "ticket-processing";

export interface TicketProcessingJob {
  merchantId: string;
  ticketId: string;
  helpdeskTicketId: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __grievanceTicketQueue:
    | Queue<TicketProcessingJob, void, string>
    | undefined;
}

export const getTicketProcessingQueue = (): Queue<
  TicketProcessingJob,
  void,
  string
> => {
  if (!global.__grievanceTicketQueue) {
    global.__grievanceTicketQueue = new Queue<TicketProcessingJob, void, string>(
      TICKET_PROCESSING_QUEUE,
      {
        connection: getRedis() as unknown as ConnectionOptions,
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 5_000,
          },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      },
    );
  }

  return global.__grievanceTicketQueue;
};

export const enqueueTicketProcessing = async (
  job: TicketProcessingJob,
  options?: JobsOptions,
): Promise<Job<TicketProcessingJob, void, string>> => {
  const ticketProcessingQueue = getTicketProcessingQueue();
  const jobId = `ticket:${job.ticketId}`;
  const existing = await ticketProcessingQueue.getJob(jobId);

  if (existing) {
    return existing;
  }

  return ticketProcessingQueue.add(jobId, job, {
    jobId,
    ...options,
  });
};
