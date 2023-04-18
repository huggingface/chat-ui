export type ApiMessage = {
	id: string;
	message: Message;
	children: string[];
	parent?: string;
};

export type Message = {
	from: 'user' | 'assistant';
	content: string;
};

export interface Token {
	id: number;
	text: string;
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

export type Conversation = {
	create_time: string;
	id: string;
	title: string;
	update_time: string;
	messages: ApiMessage[];
};
