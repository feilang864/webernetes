export interface RetryOperationOptions {
	retries: number;
	onRetry?: (error: unknown, retry: number) => void | Promise<void>;
}

export async function retryOperation<T>(
	operation: () => Promise<T>,
	{ retries, onRetry }: RetryOperationOptions,
): Promise<T> {
	for (let retry = 0; ; retry++) {
		try {
			return await operation();
		} catch (error) {
			if (retry >= retries) {
				throw error;
			}
			await onRetry?.(error, retry + 1);
		}
	}
}
