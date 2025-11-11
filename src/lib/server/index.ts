// Simple server helper to expose backend URL to the rest of the app

export const PUBLIC_BACKEND_URL =
	process.env.VITE_BACKEND_URL || process.env.PUBLIC_BACKEND_URL || "http://localhost:8000";
