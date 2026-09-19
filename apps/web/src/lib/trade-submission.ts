export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Keep recovery for ambiguous network outcomes, but unlock rejected approvals. */
export function tradeSubmissionFailure(
  submissionAttempted: boolean,
  error: unknown,
) {
  const rejected =
    error instanceof ApiError &&
    [400, 401, 403, 409, 413, 415, 422, 429].includes(error.status);
  return submissionAttempted && !rejected ? "submitted" : "approval-failed";
}
