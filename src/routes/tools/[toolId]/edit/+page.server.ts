export const actions = {
	default: async () => {
		return {
			error: true,
			errors: [
				{
					field: "spaceUrl",
					message: "Space URL is required",
				},
			],
		};
	},
};
