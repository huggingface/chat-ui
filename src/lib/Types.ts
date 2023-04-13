export type Message =
| {
	from: 'user';
	content: string;
}
| {
	from: 'bot';
	content: string;
};


export interface Token {
	id:      number;
	text:    string;
	logprob: number;
	special: boolean;
}


export interface StreamResponse {
	/**
	 * Generated token
	 */
	token: Token;
	/**
	 * Complete generated text
	 * Only available when the generation is finished
	 */
	generated_text?: string;
}
