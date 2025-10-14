export type RouterFollowUp = {
	title: string;
	prompt: string;
};

export type RouterExampleAttachment = {
	src: string;
};

export type RouterExample = {
	title: string;
	prompt: string;
	followUps?: RouterFollowUp[];
	attachments?: RouterExampleAttachment[];
};

export const routerExamples: RouterExample[] = [
	{
		title: "HTML game",
		prompt: "Code a minimal Flappy Bird game using HTML and Canvas",
		followUps: [
			{
				title: "README.md file",
				prompt: "Create a comprehensive README.md for the Flappy Bird game project.",
			},
			{
				title: "CRT Screen",
				prompt: "Add a CRT screen effect to the game",
			},
			{
				title: "Add power-ups",
				prompt:
					"Add collectible coins between pipes that award bonus points and a shield power-up that allows one collision.",
			},
			{
				title: "Explain collision detection",
				prompt:
					"Explain the collision detection algorithm for the bird and pipes in simple terms with examples.",
			},
		],
	},
	{
		title: "Weird painting",
		prompt: "is this a real painting?",
		attachments: [
			{
				src: "huggingchat/castle-example.jpg",
			},
		],
	},
	{
		title: "Landing page",
		prompt:
			"Build a responsive SaaS landing page for my AI coding assitant using Tailwind CSS. With a hero, features, testimonials, and pricing sections.",
		followUps: [
			{
				title: "Dark mode",
				prompt: "Add dark mode and make it the default",
			},
			{
				title: "Write blog post",
				prompt: "Write a blog post introducing my service.",
			},
			{
				title: "Translate to Italian",
				prompt: "Translate only the text content displayed to users into Italian.",
			},
			{
				title: "Architecture review",
				prompt:
					"Review the architecture and suggest improvements for scalability, SEO optimization, and performance.",
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
				prompt: "Provide a psychological analysis of Eminem's emotions in this song.",
			},
			{
				title: "Wired Article",
				prompt: "Write an article in the style of Wired explaining this Eminem release.",
			},
			{
				title: "Roleplay",
				prompt: "Roleplay as Eminem so I can discuss the song with him.",
			},
			{
				title: "Translate to Spanish",
				prompt: "Translate the rap lyrics to Spanish while maintaining the rhyme scheme and flow.",
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
			{
				title: "Compare philosophies",
				prompt:
					"Compare Yoda's Jedi philosophy to Stoic philosophy from ancient Greece and explain the similarities and differences.",
			},
		],
	},
	{
		title: "Generate prompts",
		prompt: `Generate 5 creative prompts Text-to-image prompts like: "Cyberpunk cityscape at night, neon lights, flying cars, rain-slicked streets, blade runner aesthetic, highly detailed`,
		followUps: [
			{
				title: "Turn into JSON",
				prompt: `Generate a detailed JSON object for each prompt. Include fields for subjects (list of objects), scene (setting, environment, background details), actions (what's happening), style (artistic style or medium)`,
			},
			{
				title: "Sci-fi portraits",
				prompt:
					"Produce five futuristic character portrait prompts with unique professions and settings.",
			},
			{
				title: "Explain image generation",
				prompt:
					"Explain how text-to-image diffusion models work, covering the denoising process and how text prompts guide generation.",
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
			{
				title: "Write a blog post",
				prompt:
					"Write a blog post about how transformers revolutionized NLP, targeting software engineers who are new to AI.",
			},
		],
	},
	{
		title: "Translate in Italian",
		prompt: `Translate in Italian: Some are born great, some achieve greatness, and some have greatness thrust upon 'em`,
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
			{
				title: "Teach me Italian",
				prompt:
					"Help me practice Italian by conversing about this Shakespeare quote, correcting my grammar when needed.",
			},
		],
	},
	{
		title: "Pelican on a bicycle",
		prompt: "Draw an SVG of a pelican riding a bicycle",
		followUps: [
			{
				title: "Add a top hat",
				prompt: "Add a fancy top hat to the pelican and make it look distinguished",
			},
			{
				title: "Make it animated",
				prompt: "Add CSS animations to make the bicycle wheels spin and the pelican's wings flap",
			},
		],
	},
];
