declare module "*.ttf" {
	const value: ArrayBuffer;
	export default value;
}

// Provide a global type used by some endpoints that expect
// HuggingFace's stream output plus optional tool and web search data.
// This mirrors older/internal naming to avoid TS "cannot find name" errors
// when the file references the type without importing it.
type WebSearchSource = {
  title?: string;
  link: string;
};

type TextGenerationStreamOutputWithToolsAndWebSources = import("@huggingface/inference").TextGenerationStreamOutput & {
  webSources?: WebSearchSource[];
  toolCalls?: unknown[];
  toolCallDelta?: unknown;
};
