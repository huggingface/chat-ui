// This is a debouncer for the updates from the server to the client
// It is used to prevent the client from being overloaded with too many updates
// It works by keeping track of the time it takes to render the updates
// and adding a safety margin to it, to find the debounce time.

class UpdateDebouncer {
	private renderStartedAt: Date | null = null;
	private lastRenderTimes: number[] = [];

	get maxUpdateTime() {
		if (this.lastRenderTimes.length === 0) {
			return 50;
		}
		return Math.max(...this.lastRenderTimes) * 3;
	}

	public startRender() {
		this.renderStartedAt = new Date();
	}

	public endRender() {
		if (!this.renderStartedAt) {
			return;
		}

		const timeSinceRenderStarted = new Date().getTime() - this.renderStartedAt.getTime();
		this.lastRenderTimes.push(timeSinceRenderStarted);
		if (this.lastRenderTimes.length > 10) {
			this.lastRenderTimes.shift();
		}
		this.renderStartedAt = null;
	}
}

export const updateDebouncer = new UpdateDebouncer();
