import { OPENAI_API_KEY } from '$env/static/private';

const FORMAT_REGEX = RegExp(/<\|(system|user|assistant)\|>([^<]+)<\/s>/g);

interface ChatCompletionMessageParam {
    content: string | null;
    role: 'system' | 'user' | 'assistant';
}

export interface ChatCompletion {
    id: string;
    choices: {
        finish_reason: 'stop' | 'length' | 'function_call';
        delta: {
            content: string | null;
            role: 'system' | 'user' | 'assistant';
        };
        index: number;
    }[];
    created: number;
    model: string;
    object: string;
    usage?: {
        completion_tokens: number;
        prompt_tokens: number;
        total_tokens: number;
    }
}


function formatMessages(prompt: string) {
    const messages: ChatCompletionMessageParam[] = [];
    let match;
    while ((match = FORMAT_REGEX.exec(prompt)) !== null) {
        messages.push({
            role: match[1] as 'system' | 'user' | 'assistant',
            content: match[2].trim()
        });
    }
    return messages;
}
export async function POST({ request }) {
    const body = await request.json();
    const prompt = body.prompt;

    const messages = formatMessages(prompt)

    const stream = await fetch(
        body.url || "https://api.openai.com/v1/chat/completions",
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': "Bearer " + body.apiKey,
            },
            body: JSON.stringify({
                messages: messages,
                stream: body.stream,
                model: body?.model,
                temperature: body?.temperature,
                max_tokens: body?.max_tokens,
            }),
            signal: request.signal
        });


    if (body.stream && stream.body) {
        return new Response(streamData(stream.body), {
            headers: {
                'content-type': 'text/event-stream',
            }
        });
    } else {
        const generated_text = await stream.json().then(
            (data) => data.choices[0].message.content
        );
        return new Response(
            JSON.stringify([{
                generated_text: generated_text
            }]),
            { headers: { "Content-Type": "application/json" } }
        );
    }
}

async function* streamData(openaiStream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    const textEncoder = new TextEncoder();
    let generated_text = '';
    for await (const chunk of openaiStream) {
        const decodedChunk = decoder.decode(chunk);

        // Clean up the data
        const lines = decodedChunk
            .split("\n")
            .map((line) => line.replace("data: ", ""))
            .filter((line) => line.length > 0)
            .filter((line) => line !== "[DONE]")
            .map((line) => JSON.parse(line));

        for (const line of lines as ChatCompletion[]) {
            const is_last_chunk = line.choices[0]?.finish_reason === 'stop';
            const text = line.choices[0]?.delta.content || '';
            generated_text += text;
            const hf_chunk = {
                token: {
                    id: is_last_chunk ? 0 : Math.floor(Math.random() * 1000),
                    text: is_last_chunk ? "" : text,
                    logprob: 0,
                    special: is_last_chunk ? true : false,
                },
                generated_text: is_last_chunk ? generated_text : null,
                details: null,
            };

            yield textEncoder.encode("data:" + JSON.stringify(hf_chunk) + "\n\n");
        }
    }
}
