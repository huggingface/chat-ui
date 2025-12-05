import type { RouterExample } from "./routerExamples";

// Examples that showcase MCP tool capabilities (web search, Hugging Face, etc.)
export const mcpExamples: RouterExample[] = [
	{
		title: "Latest world news",
		prompt: "What is the latest world news?",
		followUps: [
			{
				title: "Tech focus",
				prompt: "What about technology news?",
			},
			{
				title: "San Francisco",
				prompt: "What's happening in San Francisco?",
			},
			{
				title: "vs last week",
				prompt: "How does this compare to last week's news?",
			},
		],
	},
	{
		title: "Trending models",
		prompt: "What are the top trending models on Hugging Face?",
		followUps: [
			{
				title: "Text generation",
				prompt: "What about text generation models?",
			},
			{
				title: "Image generation",
				prompt: "What about text-to-image models?",
			},
			{
				title: "How to use",
				prompt: "Show me how to use the most popular one",
			},
		],
	},
	{
		title: "Plan a trip",
		prompt: "Things to do in Tokyo next week",
		followUps: [
			{
				title: "Transport & prices",
				prompt: "How do I get around and how much will it cost?",
			},
			{
				title: "Weather",
				prompt: "What's the weather like in Tokyo next week?",
			},
			{
				title: "Meet people",
				prompt: "Where can I meet new people and make friends?",
			},
		],
	},
	{
		title: "Compare technologies",
		prompt: "Search the web to compare React, Vue, and Svelte for building web apps in 2025",
		followUps: [
			{
				title: "Performance benchmarks",
				prompt: "Search for recent performance benchmarks comparing these frameworks",
			},
			{
				title: "Job market",
				prompt: "Search for job market trends for each of these frameworks",
			},
			{
				title: "Migration guides",
				prompt: "Search for guides on migrating from React to Svelte",
			},
		],
	},
	{
		title: "Find a dataset",
		prompt: "Find datasets on Hugging Face for training a sentiment analysis model",
		followUps: [
			{
				title: "Dataset details",
				prompt: "Tell me more about the largest dataset - its size, format, and how to load it",
			},
			{
				title: "Find models",
				prompt: "Find pre-trained models that were trained on this dataset",
			},
			{
				title: "Code snippet",
				prompt: "Show me how to load and preprocess this dataset with the datasets library",
			},
		],
	},
	{
		title: "Gift ideas",
		prompt: "Search for unique gift ideas for someone who loves cooking",
		followUps: [
			{
				title: "Budget options",
				prompt: "Search for gift ideas under $50",
			},
			{
				title: "Top rated",
				prompt: "Search for the top-rated cooking gadgets of this year",
			},
			{
				title: "DIY gifts",
				prompt: "Search for homemade gift ideas for cooking enthusiasts",
			},
		],
	},
	{
		title: "Learn something new",
		prompt: "Search for the best resources to learn Rust programming in 2025",
		followUps: [
			{
				title: "Project ideas",
				prompt: "Search for beginner Rust project ideas to practice with",
			},
			{
				title: "Find tools",
				prompt: "Search for the most popular Rust tools and libraries I should know about",
			},
			{
				title: "Community",
				prompt: "Search for Rust communities and forums where I can ask questions",
			},
		],
	},
];
