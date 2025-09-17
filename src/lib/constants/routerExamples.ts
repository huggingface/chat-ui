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
		prompt: "Create a vintage pong game in HTML",
		followUps: [
			{
				title: "Add power-ups",
				prompt:
					"Add a power-up mechanic to the Pong game so paddles temporarily grow when a player scores twice in a row.",
			},

			{
				title: "React refactor",
				prompt:
					"Refactor the Pong game into a React component that renders inside a single-page app.",
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
				prompt:
					"Translate the Pong game you just created into Italian, including any on-screen text or comments.",
			},
		],
	},
	{
		title: "Eminem song",
		prompt:
			"Write an Eminem-style rap battling AI taking over hip-hop, with two energetic verses and a catchy hook.",
		followUps: [
			{
				title: "Add chorus",
				prompt:
					"Add a new chorus to the Eminem-style AI rap that the crowd can shout back, keeping the same rhyme scheme.",
			},
			{
				title: "Explain references",
				prompt:
					"Explain the references and wordplay used in the Eminem-style AI rap to someone new to hip-hop.",
			},
			{
				title: "Radio edit",
				prompt:
					"Rewrite the Eminem-style AI rap into a clean radio edit while keeping the punchlines intact.",
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
		prompt: `Generate 10 creative prompts Text-to-image prompts like: "Cyberpunk cityscape at night, neon lights, flying cars, rain-slicked streets, blade runner aesthetic, highly detailed`,
		followUps: [
			{
				title: "More cyberpunk",
				prompt:
					"Create five more cyberpunk-themed text-to-image prompts that explore different weather conditions.",
			},
			{
				title: "Turn into JSON",
				prompt: "Convert the prompt into JSON format",
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
				title: "Generate a Quizz",
				prompt: "Create a Quizz so we can test how well I understand this.",
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
