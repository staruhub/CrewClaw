import { z } from "zod";

export const AcceptedTaskProjectionSchema = z
  .object({
    task_run_id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    goal: z.string(),
    accepted_at: z.string(),
    reviewed: z.boolean(),
  })
  .strict();

export const VerifiedEmployeeReviewSchema = z
  .object({
    id: z.string(),
    employee_id: z.string(),
    task_run_id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    rating: z.number().int().min(1).max(5),
    text: z.string().min(1).max(2_000),
    created_at: z.string(),
  })
  .strict();

export const SubmitVerifiedReviewSchema = z
  .object({
    task_run_id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    rating: z.number().int().min(1).max(5),
    text: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type AcceptedTaskProjection = z.infer<
  typeof AcceptedTaskProjectionSchema
>;
export type VerifiedEmployeeReview = z.infer<
  typeof VerifiedEmployeeReviewSchema
>;
export type SubmitVerifiedReview = z.infer<typeof SubmitVerifiedReviewSchema>;
