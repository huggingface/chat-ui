/**
 * Sequential text-to-speech playback queue for voice mode.
 *
 * Sentences are enqueued as they stream out of the model; synthesis requests
 * to /api/tts start immediately (pipelined) while playback stays strictly
 * sequential so the reply is spoken in order. `stop()` cancels everything —
 * used when the user barges in or closes voice mode.
 */

export type TtsSpeakerCallbacks = {
	/** Fired when the first queued chunk actually starts playing. */
	onPlaybackStart?: () => void;
	/** Fired when the queue runs dry (all fetched, played, or failed). */
	onIdle?: () => void;
	onError?: (message: string) => void;
};

type QueueItem = {
	buffer: Promise<AudioBuffer | null>;
};

export class TtsSpeaker {
	/** Smoothed output level in [0, 1], for driving visualizations. */
	level = 0;

	private base: string;
	private callbacks: TtsSpeakerCallbacks;

	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private timeDomainData: Float32Array<ArrayBuffer> | null = null;
	private levelInterval: ReturnType<typeof setInterval> | undefined;

	private queue: QueueItem[] = [];
	private currentSource: AudioBufferSourceNode | null = null;
	private currentPlayResolve: (() => void) | null = null;
	private pumping = false;
	private playing = false;
	private abortController = new AbortController();
	private disposed = false;

	constructor(base: string, callbacks: TtsSpeakerCallbacks) {
		this.base = base;
		this.callbacks = callbacks;
	}

	get isSpeaking(): boolean {
		return this.playing || this.queue.length > 0;
	}

	enqueue(text: string) {
		if (this.disposed) return;
		const signal = this.abortController.signal;
		this.queue.push({ buffer: this.fetchAudio(text, signal) });
		void this.pump();
	}

	/** Cancel pending synthesis and stop playback immediately. */
	stop() {
		this.abortController.abort();
		this.abortController = new AbortController();
		this.queue = [];
		if (this.currentSource) {
			try {
				this.currentSource.onended = null;
				this.currentSource.stop();
			} catch {
				// already stopped
			}
			this.currentSource = null;
		}
		// Unblock the pump loop, which awaits the interrupted chunk's promise
		this.currentPlayResolve?.();
		this.currentPlayResolve = null;
		this.playing = false;
		this.level = 0;
	}

	dispose() {
		this.disposed = true;
		this.stop();
		if (this.levelInterval) clearInterval(this.levelInterval);
		this.levelInterval = undefined;
		void this.audioContext?.close().catch(() => {});
		this.audioContext = null;
		this.analyser = null;
	}

	private ensureContext(): AudioContext {
		if (!this.audioContext) {
			this.audioContext = new AudioContext();
			this.analyser = this.audioContext.createAnalyser();
			this.analyser.fftSize = 1024;
			this.analyser.smoothingTimeConstant = 0;
			this.analyser.connect(this.audioContext.destination);
			this.timeDomainData = new Float32Array(this.analyser.fftSize);
			this.levelInterval = setInterval(() => this.updateLevel(), 50);
		}
		void this.audioContext.resume().catch(() => {});
		return this.audioContext;
	}

	private updateLevel() {
		if (!this.playing || !this.analyser || !this.timeDomainData) {
			this.level = this.level * 0.6;
			return;
		}
		this.analyser.getFloatTimeDomainData(this.timeDomainData);
		let sum = 0;
		for (let i = 0; i < this.timeDomainData.length; i++) {
			const v = this.timeDomainData[i];
			sum += v * v;
		}
		const rms = Math.sqrt(sum / this.timeDomainData.length);
		this.level = this.level * 0.5 + Math.min(1, rms * 4) * 0.5;
	}

	private async fetchAudio(text: string, signal: AbortSignal): Promise<AudioBuffer | null> {
		try {
			const response = await fetch(`${this.base}/api/tts`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text }),
				signal,
			});
			if (!response.ok) {
				throw new Error(`TTS request failed (${response.status})`);
			}
			const data = await response.arrayBuffer();
			if (signal.aborted) return null;
			return await this.ensureContext().decodeAudioData(data);
		} catch (err) {
			if (signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
				return null;
			}
			console.error("TTS error:", err);
			this.callbacks.onError?.("Speech synthesis failed.");
			return null;
		}
	}

	private async pump() {
		if (this.pumping || this.disposed) return;
		this.pumping = true;
		try {
			while (this.queue.length > 0) {
				const item = this.queue[0];
				const buffer = await item.buffer;
				// stop() may have cleared the queue while we awaited
				if (this.queue[0] !== item) continue;
				this.queue.shift();
				if (!buffer) continue;
				await this.play(buffer);
			}
		} finally {
			this.pumping = false;
			if (!this.playing && this.queue.length === 0) {
				this.callbacks.onIdle?.();
			}
		}
	}

	private play(buffer: AudioBuffer): Promise<void> {
		return new Promise((resolve) => {
			const ctx = this.ensureContext();
			if (!this.analyser) {
				resolve();
				return;
			}
			const source = ctx.createBufferSource();
			source.buffer = buffer;
			source.connect(this.analyser);
			this.currentSource = source;
			this.currentPlayResolve = resolve;
			if (!this.playing) {
				this.playing = true;
				this.callbacks.onPlaybackStart?.();
			}
			source.onended = () => {
				if (this.currentSource === source) {
					this.currentSource = null;
					if (this.queue.length === 0) {
						this.playing = false;
					}
				}
				if (this.currentPlayResolve === resolve) {
					this.currentPlayResolve = null;
				}
				resolve();
			};
			source.start();
		});
	}
}
