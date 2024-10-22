import type { Conversation } from "$lib/types/Conversation";
import { expect, test } from "vitest";
import endpointTgi from "./endpointTgi";
import { HF_ACCESS_TOKEN, HF_API_ROOT } from "$env/static/private";
import { addEndpoint, processModel, modelConfig } from "$lib/server/models";

test("endpoint-tgi", async () => {
	const conversation: Pick<Conversation, "messages"> = {
		messages: [
			{
				id: "0000-0000-0000-0000-0000",
				from: "user",
				content: "hello world",
			},
		],
	};

	const model = await processModel(
		modelConfig.parse({
			name: "mistralai/Mistral-7B-Instruct-v0.1",
			chatPromptTemplate:
				"<s>{{#each messages}}{{#ifUser}}[INST] {{#if @first}}{{#if @root.preprompt}}{{@root.preprompt}}\n{{/if}}{{/if}}{{content}} [/INST]{{/ifUser}}{{#ifAssistant}}{{content}}</s>{{/ifAssistant}}{{/each}}",
		})
	).then(addEndpoint);

	const tokenStream = await endpointTgi({
		accessToken: HF_ACCESS_TOKEN ?? "",
		model,
		weight: 1,
		type: "tgi",
		url: `${HF_API_ROOT}/${model.name}`,
	})({
		conversation,
	});

	const out = (await tokenStream.next()).value;

	expect(out).toBeDefined();
	expect(out && out.token.text).toBeTruthy;
});
