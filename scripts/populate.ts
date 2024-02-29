import readline from "readline";
import minimist from "minimist";

// @ts-expect-error: vite-node makes the var available but the typescript compiler doesn't see them
import { MONGODB_URL } from "$env/static/private";

import { faker } from "@faker-js/faker";
import { ObjectId } from "mongodb";

import { collections } from "../src/lib/server/database.ts";
import { models } from "../src/lib/server/models.ts";
import type { User } from "../src/lib/types/User";
import type { Assistant } from "../src/lib/types/Assistant";
import type { Conversation } from "../src/lib/types/Conversation";
import type { Settings } from "../src/lib/types/Settings";
import { defaultEmbeddingModel } from "../src/lib/server/embeddingModels.ts";
import { Message } from "../src/lib/types/Message.ts";

import { addChildren } from "../src/lib/utils/tree/addChildren.ts";

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

rl.on("close", function () {
	process.exit(0);
});

const possibleFlags = ["reset", "all", "users", "settings", "assistants", "conversations"];
const argv = minimist(process.argv.slice(2));
const flags = argv["_"].filter((flag) => possibleFlags.includes(flag));

async function generateMessages(preprompt?: string): Promise<Message[]> {
	const isLinear = faker.datatype.boolean(0.5);
	const isInterrupted = faker.datatype.boolean(0.05);

	const messages: Message[] = [];

	messages.push({
		id: crypto.randomUUID(),
		from: "system",
		content: preprompt ?? "",
		createdAt: faker.date.recent({ days: 30 }),
		updatedAt: faker.date.recent({ days: 30 }),
	});

	let isUser = true;
	let lastId = messages[0].id;
	if (isLinear) {
		const convLength = faker.number.int({ min: 1, max: 25 }) * 2; // must always be even

		for (let i = 0; i < convLength; i++) {
			lastId = addChildren(
				{
					messages,
					rootMessageId: messages[0].id,
				},
				{
					from: isUser ? "user" : "assistant",
					content: faker.lorem.sentence({
						min: 10,
						max: isUser ? 50 : 200,
					}),
					createdAt: faker.date.recent({ days: 30 }),
					updatedAt: faker.date.recent({ days: 30 }),
					interrupted: i === convLength - 1 && isInterrupted,
				},
				lastId
			);
			isUser = !isUser;
		}
	} else {
		const convLength = faker.number.int({ min: 2, max: 200 });

		for (let i = 0; i < convLength; i++) {
			addChildren(
				{
					messages,
					rootMessageId: messages[0].id,
				},
				{
					from: isUser ? "user" : "assistant",
					content: faker.lorem.sentence({
						min: 10,
						max: isUser ? 50 : 200,
					}),
					createdAt: faker.date.recent({ days: 30 }),
					updatedAt: faker.date.recent({ days: 30 }),
					interrupted: i === convLength - 1 && isInterrupted,
				},
				faker.helpers.arrayElement([
					messages[0].id,
					...messages.filter((m) => m.from === (isUser ? "assistant" : "user")).map((m) => m.id),
				])
			);

			isUser = !isUser;
		}
	}
	return messages;
}

async function seed() {
	console.log("Seeding...");
	const modelIds = models.map((model) => model.id);

	if (flags.includes("reset")) {
		await collections.users.deleteMany({});
		await collections.settings.deleteMany({});
		await collections.assistants.deleteMany({});
		await collections.conversations.deleteMany({});
		console.log("Reset done");
	}

	if (flags.includes("users") || flags.includes("all")) {
		const newUsers: User[] = Array.from({ length: 100 }, () => ({
			_id: new ObjectId(),
			createdAt: faker.date.recent({ days: 30 }),
			updatedAt: faker.date.recent({ days: 30 }),
			username: faker.internet.userName(),
			name: faker.person.fullName(),
			hfUserId: faker.string.alphanumeric(24),
			avatarUrl: faker.image.avatar(),
		}));

		await collections.users.insertMany(newUsers);
	}
	const users = await collections.users.find().toArray();
	if (flags.includes("settings") || flags.includes("all")) {
		users.forEach(async (user) => {
			const settings: Settings = {
				userId: user._id,
				shareConversationsWithModelAuthors: faker.datatype.boolean(0.25),
				hideEmojiOnSidebar: faker.datatype.boolean(0.25),
				ethicsModalAcceptedAt: faker.date.recent({ days: 30 }),
				activeModel: faker.helpers.arrayElement(modelIds),
				createdAt: faker.date.recent({ days: 30 }),
				updatedAt: faker.date.recent({ days: 30 }),
				customPrompts: {},
				assistants: [],
			};
			await collections.settings.updateOne(
				{ userId: user._id },
				{ $set: { ...settings } },
				{ upsert: true }
			);
		});
	}

	if (flags.includes("assistants") || flags.includes("all")) {
		await Promise.all(
			users.map(async (user) => {
				const assistants = faker.helpers.multiple<Assistant>(
					() => ({
						_id: new ObjectId(),
						name: faker.animal.insect(),
						createdById: user._id,
						createdByName: user.username,
						createdAt: faker.date.recent({ days: 30 }),
						updatedAt: faker.date.recent({ days: 30 }),
						userCount: faker.number.int({ min: 1, max: 100000 }),
						featured: faker.datatype.boolean(0.25),
						modelId: faker.helpers.arrayElement(modelIds),
						description: faker.lorem.sentence(),
						preprompt: faker.hacker.phrase(),
						exampleInputs: faker.helpers.multiple(() => faker.lorem.sentence(), {
							count: faker.number.int({ min: 0, max: 4 }),
						}),
					}),
					{ count: faker.number.int({ min: 3, max: 10 }) }
				);
				await collections.assistants.insertMany(assistants);
				await collections.settings.updateOne(
					{ userId: user._id },
					{ $set: { assistants: assistants.map((a) => a._id.toString()) } },
					{ upsert: true }
				);
			})
		);
	}

	if (flags.includes("conversations") || flags.includes("all")) {
		await Promise.all(
			users.map(async (user) => {
				const conversations = faker.helpers.multiple(
					async () => {
						const settings = await collections.settings.findOne<Settings>({ userId: user._id });

						const assistantId =
							settings?.assistants && settings.assistants.length > 0 && faker.datatype.boolean(0.1)
								? faker.helpers.arrayElement<ObjectId>(settings.assistants)
								: undefined;

						const preprompt =
							(assistantId
								? await collections.assistants
										.findOne({ _id: assistantId })
										.then((assistant: Assistant) => assistant?.preprompt ?? "")
								: faker.helpers.maybe(() => faker.hacker.phrase(), { probability: 0.5 })) ?? "";

						const messages = await generateMessages(preprompt);

						const conv = {
							_id: new ObjectId(),
							userId: user._id,
							assistantId,
							preprompt,
							createdAt: faker.date.recent({ days: 145 }),
							updatedAt: faker.date.recent({ days: 145 }),
							model: faker.helpers.arrayElement(modelIds),
							title: faker.internet.emoji() + " " + faker.hacker.phrase(),
							embeddingModel: defaultEmbeddingModel.id,
							messages,
							rootMessageId: messages[0].id,
						} satisfies Conversation;

						return conv;
					},
					{ count: faker.number.int({ min: 10, max: 200 }) }
				);

				await collections.conversations.insertMany(await Promise.all(conversations));
			})
		);
	}
}

// run seed
(async () => {
	try {
		rl.question(
			"You're about to run a seeding script on the following MONGODB_URL: \x1b[31m" +
				MONGODB_URL +
				"\x1b[0m\n\n With the following flags: \x1b[31m" +
				flags.join("\x1b[0m , \x1b[31m") +
				"\x1b[0m\n \n\n Are you sure you want to continue? (yes/no): ",
			async (confirm) => {
				if (confirm !== "yes") {
					console.log("Not 'yes', exiting.");
					rl.close();
					process.exit(0);
				}
				console.log("Starting seeding...");
				await seed();
				rl.close();
			}
		);
	} catch (e) {
		console.error(e);
		process.exit(1);
	}
})();
