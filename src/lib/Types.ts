export type Message =
| {
	from: 'user';
	content: string;
}
| {
	from: 'bot';
	content: string;
};

