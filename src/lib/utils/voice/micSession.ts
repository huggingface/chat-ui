/**
 * Microphone session with lightweight energy-based voice activity detection,
 * used by voice mode for hands-free turn taking.
 *
 * A MediaRecorder runs continuously; when the VAD detects end of speech the
 * recorder is cut and the utterance blob is handed to the caller (who sends
 * it to /api/transcribe), then a fresh recorder starts for the next turn.
 * Recording through silence (instead of starting at speech onset) means the
 * first syllable is never clipped.
 */

export type MicSessionCallbacks = {
	onSpeechStart?: () => void;
	onSpeechEnd?: (audio: Blob | null, durationMs: number) => void;
	onError?: (message: string) => void;
};

/** Higher threshold + longer confirmation while TTS is playing, so the
 * assistant's own voice (or room echo) doesn't barge in on itself. */
export type VadSensitivity = "normal" | "guarded";

const TICK_MS = 50;
// Sustained speech required to count as "speaking"
const ATTACK_MS = { normal: 100, guarded: 250 };
// Silence required to close an utterance
const RELEASE_MS = 750;
// Discard blips shorter than this instead of transcribing them
const MIN_SPEECH_MS = 300;
// Restart an idle recorder periodically so utterance blobs don't accumulate
// minutes of leading silence
const MAX_IDLE_RECORDING_MS = 45_000;

export class MicSession {
	/** Smoothed input level in [0, 1], for driving visualizations. */
	level = 0;
	muted = false;

	private callbacks: MicSessionCallbacks;
	private sensitivity: VadSensitivity = "normal";

	private stream: MediaStream | null = null;
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private timeDomainData: Float32Array<ArrayBuffer> | null = null;

	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private recorderStartedAt = 0;

	private tickInterval: ReturnType<typeof setInterval> | undefined;
	private noiseFloor = 0.008;
	private inSpeech = false;
	private speechCandidateSince: number | null = null;
	private silenceSince: number | null = null;
	private speechStartedAt = 0;
	private disposed = false;

	constructor(callbacks: MicSessionCallbacks) {
		this.callbacks = callbacks;
	}

	async start(): Promise<void> {
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: 1,
					sampleRate: 16000, // Whisper prefers 16kHz
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
			});
		} catch (err) {
			if (err instanceof DOMException && err.name === "NotAllowedError") {
				this.callbacks.onError?.("Microphone access denied. Please allow it in browser settings.");
			} else if (err instanceof DOMException && err.name === "NotFoundError") {
				this.callbacks.onError?.("No microphone found.");
			} else {
				this.callbacks.onError?.("Could not access the microphone.");
			}
			throw err;
		}

		this.audioContext = new AudioContext();
		// Some browsers create the context suspended until a user gesture
		void this.audioContext.resume().catch(() => {});
		const source = this.audioContext.createMediaStreamSource(this.stream);
		this.analyser = this.audioContext.createAnalyser();
		this.analyser.fftSize = 1024;
		this.analyser.smoothingTimeConstant = 0;
		source.connect(this.analyser);
		this.timeDomainData = new Float32Array(this.analyser.fftSize);

		this.startRecorder();
		this.tickInterval = setInterval(() => this.tick(), TICK_MS);
	}

	setSensitivity(sensitivity: VadSensitivity) {
		this.sensitivity = sensitivity;
	}

	setMuted(muted: boolean) {
		this.muted = muted;
		this.stream?.getAudioTracks().forEach((track) => {
			track.enabled = !muted;
		});
		if (muted) {
			// Cancel any half-detected utterance and trim the recording
			this.inSpeech = false;
			this.speechCandidateSince = null;
			this.silenceSince = null;
			this.level = 0;
			void this.restartRecorder();
		}
	}

	dispose() {
		this.disposed = true;
		if (this.tickInterval) clearInterval(this.tickInterval);
		this.tickInterval = undefined;
		if (this.recorder && this.recorder.state !== "inactive") {
			try {
				this.recorder.stop();
			} catch {
				// already stopped
			}
		}
		this.recorder = null;
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		void this.audioContext?.close().catch(() => {});
		this.audioContext = null;
		this.analyser = null;
	}

	private startRecorder() {
		if (!this.stream || this.disposed) return;
		const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
			? "audio/webm;codecs=opus"
			: MediaRecorder.isTypeSupported("audio/webm")
				? "audio/webm"
				: "audio/mp4";
		this.chunks = [];
		this.recorder = new MediaRecorder(this.stream, { mimeType });
		this.recorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.chunks.push(e.data);
		};
		this.recorder.start(100);
		this.recorderStartedAt = performance.now();
	}

	/** Stop the active recorder, resolve with its blob, and start a new one. */
	private restartRecorder(): Promise<Blob | null> {
		return new Promise((resolve) => {
			const recorder = this.recorder;
			if (!recorder || recorder.state === "inactive") {
				this.startRecorder();
				resolve(null);
				return;
			}
			recorder.onstop = () => {
				const blob =
					this.chunks.length > 0
						? new Blob(this.chunks, { type: this.chunks[0]?.type || "audio/webm" })
						: null;
				this.startRecorder();
				resolve(blob);
			};
			recorder.stop();
		});
	}

	private readLevel(): number {
		if (!this.analyser || !this.timeDomainData) return 0;
		this.analyser.getFloatTimeDomainData(this.timeDomainData);
		let sum = 0;
		for (let i = 0; i < this.timeDomainData.length; i++) {
			const v = this.timeDomainData[i];
			sum += v * v;
		}
		return Math.sqrt(sum / this.timeDomainData.length);
	}

	private tick() {
		if (this.disposed || this.muted) return;
		const now = performance.now();
		const rms = this.readLevel();

		// Smooth the visualization level; normalize so speech fills ~the full range
		const target = Math.min(1, rms * 12);
		this.level = this.level * 0.6 + target * 0.4;

		// Track the ambient noise floor while nobody is speaking
		if (!this.inSpeech) {
			this.noiseFloor = Math.min(0.05, Math.max(0.001, this.noiseFloor * 0.95 + rms * 0.05));
		}

		const guarded = this.sensitivity === "guarded";
		const threshold = guarded
			? Math.max(0.03, this.noiseFloor * 5)
			: Math.max(0.012, this.noiseFloor * 3);

		if (!this.inSpeech) {
			if (rms >= threshold) {
				this.speechCandidateSince ??= now;
				if (now - this.speechCandidateSince >= ATTACK_MS[this.sensitivity]) {
					this.inSpeech = true;
					this.speechStartedAt = this.speechCandidateSince;
					this.silenceSince = null;
					this.callbacks.onSpeechStart?.();
				}
			} else {
				this.speechCandidateSince = null;
				// Trim endless leading silence from the pending recording
				if (now - this.recorderStartedAt > MAX_IDLE_RECORDING_MS) {
					void this.restartRecorder();
				}
			}
			return;
		}

		// In speech: wait for sustained silence to close the utterance
		if (rms < threshold) {
			this.silenceSince ??= now;
			if (now - this.silenceSince >= RELEASE_MS) {
				const durationMs = this.silenceSince - this.speechStartedAt;
				this.inSpeech = false;
				this.speechCandidateSince = null;
				this.silenceSince = null;
				void this.restartRecorder().then((blob) => {
					if (this.disposed) return;
					if (durationMs < MIN_SPEECH_MS) return; // blip: discard silently
					this.callbacks.onSpeechEnd?.(blob, durationMs);
				});
			}
		} else {
			this.silenceSince = null;
		}
	}
}
