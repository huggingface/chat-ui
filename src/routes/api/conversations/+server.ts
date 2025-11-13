// This endpoint is deprecated - use client-side storage directly
// Kept for backward compatibility but returns empty response
export async function GET() {
	return Response.json([]);
}

export async function DELETE() {
	return new Response();
}
