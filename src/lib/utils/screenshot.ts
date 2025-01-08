export async function captureScreen(): Promise<string> {
	let stream: MediaStream | undefined;
	try {
		// This will show the native browser dialog for screen capture
		stream = await navigator.mediaDevices.getDisplayMedia({
			video: true,
			audio: false,
		});

		// Create a canvas element to capture the screenshot
		const canvas = document.createElement("canvas");
		const video = document.createElement("video");

		// Wait for the video to load metadata
		await new Promise((resolve) => {
			video.onloadedmetadata = () => {
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;
				video.play();
				resolve(null);
			};
			if (stream) {
				video.srcObject = stream;
			} else {
				throw Error("No stream available");
			}
		});

		// Draw the video frame to canvas
		const context = canvas.getContext("2d");
		context?.drawImage(video, 0, 0, canvas.width, canvas.height);
		// Convert to base64
		return canvas.toDataURL("image/png");
	} catch (error) {
		console.error("Error capturing screenshot:", error);
		throw error;
	} finally {
		// Stop all tracks
		if (stream) {
			stream.getTracks().forEach((track) => track.stop());
		}
	}
}
