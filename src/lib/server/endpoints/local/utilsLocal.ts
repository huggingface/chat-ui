import { getLlama as getNodeLlama, type Llama } from "node-llama-cpp";
import { logger } from "$lib/server/logger";
import { onExit } from "$lib/server/exitHandler";

/**
 * Utility class to manage a single Llama instance across the application
 */
export class LlamaManager {
	private static llamaInstance: Llama | null = null;
	private static initializationPromise: Promise<Llama> | null = null;

	/**
	 * Get the Llama instance, initializing it if necessary
	 */
	public static async getLlama(): Promise<Llama> {
		if (LlamaManager.llamaInstance) {
			return LlamaManager.llamaInstance;
		}

		if (LlamaManager.initializationPromise) {
			return LlamaManager.initializationPromise;
		}

		LlamaManager.initializationPromise = getNodeLlama()
			.then((llama) => {
				LlamaManager.llamaInstance = llama;
				LlamaManager.initializationPromise = null;
				return llama;
			})
			.catch((error) => {
				logger.error(`Failed to initialize Llama: ${error}`);
				LlamaManager.initializationPromise = null;
				throw error;
			});

		onExit(async () => {
			logger.info("Disposing Llama instance");
			await LlamaManager.disposeLlama();
		});

		return LlamaManager.initializationPromise;
	}

	/**
	 * Check if the Llama instance is initialized
	 * @returns true if the Llama instance is initialized, false otherwise
	 */
	public static get isInitialized(): boolean {
		return LlamaManager.llamaInstance !== null;
	}

	/**
	 * Dispose the Llama instance and free resources
	 */
	public static async disposeLlama(): Promise<void> {
		if (LlamaManager.llamaInstance) {
			try {
				await LlamaManager.llamaInstance.dispose();
				logger.info("Llama instance successfully disposed");
			} catch (error) {
				logger.error(`Error disposing Llama instance: ${error}`);
			} finally {
				LlamaManager.llamaInstance = null;
			}
		}
	}
}
