export async function captureScreen(): Promise<string> {
    try {
      // This will show the native browser dialog for screen capture
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      
      const track = stream.getVideoTracks()[0];
      
      // Create a canvas element to capture the screenshot
      const canvas = document.createElement('canvas');
      const video = document.createElement('video');
      
      // Wait for the video to load metadata
      await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          video.play();
          resolve(null);
        };
        video.srcObject = stream;
      });
      
      // Draw the video frame to canvas
      const context = canvas.getContext('2d');
      context?.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());
      
      // Convert to base64
      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error('Error capturing screenshot:', error);
      throw error;
    }
  } 