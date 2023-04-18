import { HfInference } from '@huggingface/inference';
import { env } from '$env/dynamic/private';
import { PUBLIC_MODEL_ENDPOINT } from '$env/static/public';

const hf = new HfInference(
	undefined,
	{
		headers: {
			Authorization: `Basic ${env.HF_TOKEN}`
		}
	},
	PUBLIC_MODEL_ENDPOINT
);

function iteratorToStream(iterator: AsyncGenerator) {
	return new ReadableStream({
		async pull(controller) {
			const { value, done } = await iterator.next();
			if (done) {
				controller.close();
			} else {
				controller.enqueue(JSON.stringify(value));
			}
		}
	});
}

export async function POST({ request }) {
	const body = await request.json();
	let hfRes;

	try {
		hfRes = hf.textGenerationStream(
			{
				inputs: body.inputs,
				parameters: {
					// Taken from https://huggingface.co/spaces/huggingface/open-assistant-private-testing/blob/main/app.py#L54
					// @ts-ignore
					stop: ['<|endoftext|>'],
					max_new_tokens: 1024,
					truncate: 1024,
					typical_p: 0.2
				}
			},
			{
				use_cache: false
			}
		);
	} catch (e) {
		return new Response('Error', {
			status: 500
		});
	}

	const stream = iteratorToStream(hfRes);

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream'
		}
	});
}
