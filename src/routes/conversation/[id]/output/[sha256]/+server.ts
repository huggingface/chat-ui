// This endpoint is deprecated - files are now stored client-side
// Kept for backward compatibility but returns 404
import { error } from "@sveltejs/kit";
import { z } from "zod";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params }) => {
	z.string().parse(params.sha256);
	error(404, "File not found - use client-side storage");
};
