import { collections } from '$lib/server/database.js';
import { z } from 'zod';

export async function POST({locals, request}) {
  const json = await request.json();

  const settings = z.object({
    shareConversationsWithModelAuthors: z.boolean().default(true),
  }).parse(json);

  await collections.settings.updateOne({
    sessionId: locals.sessionId,
  }, {
    $set: settings,
  }, {
    upsert: true,
  });

  return new Response()
}