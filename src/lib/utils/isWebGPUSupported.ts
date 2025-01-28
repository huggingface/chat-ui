export async function isWebGPUSupported() {
	try {
		// @ts-expect-error gpu is not yet typed
		const adapter = await navigator.gpu.requestAdapter();
		const device = await adapter.requestDevice();
		return device !== null;
	} catch (e) {
		return false;
	}
}
