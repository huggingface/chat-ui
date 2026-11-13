import { HubApiError } from "@huggingface/hub";

const CREATE_SETTLE_MS = [1_000, 2_000, 4_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** a repo created a moment ago still 404s its first write, a bucket its xet write token */
export async function afterCreate<T>(write: () => Promise<T>): Promise<T> {
	for (const wait of CREATE_SETTLE_MS) {
		try {
			return await write();
		} catch (err) {
			if (!(err instanceof HubApiError) || err.statusCode !== 404) throw err;
			await sleep(wait);
		}
	}
	return write();
}
