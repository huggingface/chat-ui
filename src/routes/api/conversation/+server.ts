import { HfInference } from '@huggingface/inference';
import { MODEL_ENDPOINT, HF_TOKEN } from '$env/static/private';

const hf = new HfInference(
	undefined,
	{
		headers: {
			Authorization: `Basic ${HF_TOKEN}`
		}
	},
	MODEL_ENDPOINT
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
					max_new_tokens: 250,
					// @ts-ignore
					stop_sequences: ['<|endoftext|>'],
					truncate: 1024
					// do_sample: false,
					// return_full_text: false,
					// typical_p: 0.2,
					// watermark: false,
					// details: true
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
