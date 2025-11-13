// This endpoint is deprecated - use client-side storage directly
// Kept for backward compatibility but returns 404
import { z } from "zod";

export async function GET({ params }) {
	const id = z.string().parse(params.id);
	return Response.json({ message: "Conversation not found" }, { status: 404 });
}
