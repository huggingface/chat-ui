export type RouterFollowUp = {
	title: string;
	prompt: string;
};

export type RouterExample = {
	title: string;
	prompt: string;
	followUps?: RouterFollowUp[];
};

export const routerExamples: RouterExample[] = [
	{
		title: "Pong game",
		prompt: "Create a minimalist pong game using  HTML and tailwindcss",
		followUps: [
			{
				title: "README.md file",
				prompt: "Create a comprehensive README.md for the Pong game project.",
			},
			{
				title: "Add power-ups",
				prompt:
					"Add a power-up mechanic to the Pong game so paddles temporarily grow when a player scores twice in a row.",
			},

			{
				title: "CRT Screen",
				prompt: "Add a CRT screen effect to the game",
			},
		],
	},
	{
		title: "Landing page",
		prompt:
			"Build a responsive SaaS landing page using Tailwind CSS with a hero, features, testimonials, and pricing sections.",
		followUps: [
			{
				title: "Dark mode",
				prompt:
					"Extend the Tailwind CSS landing page with a toggleable dark mode that remembers the user's choice.",
			},
			{
				title: "Add blog teasers",
				prompt:
					"Add a latest blog posts section to the Tailwind CSS landing page with three article cards and call-to-action buttons.",
			},
			{
				title: "Translate to Italian",
				prompt: "Translate the visible content of the page into italian",
			},
		],
	},
	{
		title: "Eminem song",
		prompt:
			"Write an Eminem-style rap battling AI taking over hip-hop, with two energetic verses and a catchy hook.",
		followUps: [
			{
				title: "Psychological analysis",
				prompt: "Provide a psychological analysis of Eminem’s emotions in this song.",
			},
			{
				title: "Wired Article",
				prompt: "Write an article in the style of Wired explaining this Eminem release.",
			},
			{
				title: "Roleplay",
				prompt: "Roleplay as Eminem so I can discuss the song with him.",
			},
		],
	},
	{
		title: "Act as Yoda",
		prompt: "Act as Yoda",
		followUps: [
			{
				title: "Give advice",
				prompt:
					"Continue acting as Yoda and offer three pieces of life advice for staying focused under pressure.",
			},
			{
				title: "Explain the Force",
				prompt:
					"In Yoda's voice, explain the concept of the Force to a young padawan using modern language.",
			},
			{
				title: "Plain English",
				prompt:
					"Rewrite the previous response from Yoda into plain English while keeping the same meaning.",
			},
		],
	},
	{
		title: "Generate prompts",
		prompt: `Generate 5 creative prompts Text-to-image prompts like: "Cyberpunk cityscape at night, neon lights, flying cars, rain-slicked streets, blade runner aesthetic, highly detailed`,
		followUps: [
			{
				title: "Turn into JSON",
				prompt: `Generate a detailed JSON object for each prompt. Include fields for subjects (list of objects), scene (setting, environment, background details), actions (what’s happening), style (artistic style or medium)`,
			},
			{
				title: "Sci-fi portraits",
				prompt:
					"Produce five futuristic character portrait prompts with unique professions and settings.",
			},
		],
	},
	{
		title: "Explain LLMs",
		prompt:
			"Explain how large language models based on transformers work, covering attention, embeddings, and training objectives.",
		followUps: [
			{
				title: "Generate a Quiz",
				prompt: "Craft a 5-question multiple-choice quiz to validate what I learned.",
			},
			{
				title: "Compare to RNNs",
				prompt:
					"Compare transformer-based large language models to recurrent neural networks, focusing on training efficiency and capabilities.",
			},
			{
				title: "Student summary",
				prompt:
					"Summarize the explanation of large language models for a high school student using relatable analogies.",
			},
		],
	},
	{
		title: "Translate in Italian",
		prompt: `Translate in Italian: Some are born great, some achieve greatness, and some have greatness thrust upon ’em`,
		followUps: [
			{
				title: "Back to English",
				prompt:
					"Translate the Italian version back into English while keeping Shakespeare's tone intact.",
			},
			{
				title: "Explain choices",
				prompt: "Explain your translation choices for each key phrase from the Italian version.",
			},
			{
				title: "Modernize",
				prompt:
					"Modernize the Italian translation into contemporary informal Italian suitable for social media.",
			},
		],
	},
];
