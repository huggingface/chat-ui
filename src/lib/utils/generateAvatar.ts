import { HF_TOKEN, TEXT_TO_IMAGE_MODEL } from "$env/static/private";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint";
import { HfInference } from "@huggingface/inference";

export async function generateAvatar(description?: string, name?: string): Promise<File> {
	const queryPrompt = `Generate a prompt for an image-generation model for the following: 
Name: ${name}
Description: ${description}
`;
	const imagePrompt = await generateFromDefaultEndpoint({
		messages: [{ from: "user", content: queryPrompt }],
		preprompt:
			"You are an assistant tasked with generating simple image descriptions. The user will ask you for an image, based on the name and a description of what they want, and you should reply with a short, concise, safe, descriptive sentence.",
	});

	const hf = new HfInference(HF_TOKEN);

	const blob = await hf.textToImage({
		inputs: imagePrompt,
		model: TEXT_TO_IMAGE_MODEL,
	});

	return new File([blob], "avatar.png");
}
