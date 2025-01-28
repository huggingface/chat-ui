import { AutomaticSpeechRecognitionPipeline, pipeline } from "@huggingface/transformers";
import { WaveFile } from "wavefile";

type AudioMessage = {
	audioUrl: URL;
	type: "audio";
	language: string;
};

type TranscriptionMessage = {
	transcription: string;
	type: "transcription";
};

type DownloadProgressMessage = {
	progress: number;
	type: "progress";
};

type ErrorMessage = {
	error: string;
	type: "error";
};

type UpdateMessage = {
	message: "downloading" | "ready";
	type: "update";
};

type Message =
	| AudioMessage
	| TranscriptionMessage
	| DownloadProgressMessage
	| ErrorMessage
	| UpdateMessage;

class TranscriberSingleton {
	private pipeline: AutomaticSpeechRecognitionPipeline | null = null;

	public async getPipeline() {
		if (!this.pipeline) {
			const filesToBeDownloaded: Array<{ file: string; total: number; loaded: number }> = [];

			self.postMessage({
				message: "downloading",
				type: "update",
			});

			this.pipeline = await pipeline(
				"automatic-speech-recognition",
				"onnx-community/whisper-base",
				{
					device: "webgpu",
					progress_callback: (ev) => {
						if (!filesToBeDownloaded.find((f) => f.file === ev.file)) {
							filesToBeDownloaded.push({
								file: ev.file,
								total: ev.total ?? 0,
								loaded: ev.loaded ?? 0,
							});
						} else {
							const file = filesToBeDownloaded.find((f) => f.file === ev.file);
							if (file) {
								file.loaded = ev.loaded ?? 0;
								file.total = ev.total ?? 0;
							}
						}

						if (filesToBeDownloaded.some((f) => f.total === 0) && filesToBeDownloaded.length < 2) {
							return;
						}

						const totalLoaded = filesToBeDownloaded.reduce((acc, f) => acc + f.loaded, 0);
						const totalSize = filesToBeDownloaded.reduce((acc, f) => acc + f.total, 0);

						const newProgress = totalLoaded / totalSize;
						if (!isNaN(newProgress) && isFinite(newProgress)) {
							self.postMessage({
								type: "progress",
								progress: newProgress,
							});
						}
					},
				}
			);

			self.postMessage({
				message: "ready",
				type: "update",
			});
		}
		return this.pipeline;
	}
}

const transcriberSingleton = new TranscriberSingleton();

async function processAudioUrl(audioUrl: URL): Promise<Float64Array> {
	const arrayBuffer = await fetch(audioUrl).then((x) => x.arrayBuffer());
	const buffer = new Uint8Array(arrayBuffer);
	const wav = new WaveFile(buffer);
	wav.toBitDepth("32f"); // Pipeline expects input as a Float32Array
	wav.toSampleRate(16000); // Whisper expects audio with a sampling rate of 16000
	let audioData = wav.getSamples();
	if (Array.isArray(audioData)) {
		if (audioData.length > 1) {
			const SCALING_FACTOR = Math.sqrt(2);

			// Merge channels (into first channel to save memory)
			for (let i = 0; i < audioData[0].length; ++i) {
				audioData[0][i] = (SCALING_FACTOR * (audioData[0][i] + audioData[1][i])) / 2;
			}
		}

		audioData = audioData[0];
	}

	return audioData;
}

self.onmessage = async (ev: MessageEvent<Message>) => {
	if (ev.data.type === "audio") {
		const audioUrl = ev.data.audioUrl;
		const pipeline = await transcriberSingleton.getPipeline();

		const audioData = await processAudioUrl(audioUrl);

		await pipeline(audioData, {
			language: ev.data.language,
			task: "transcribe",
		})
			.then((output) => {
				if (Array.isArray(output)) {
					return output.map((o) => o.text).join(" ");
				}
				return output.text;
			})
			.then((transcription) => {
				self.postMessage({
					type: "transcription",
					transcription,
				});
			});
	}
};
