import type { ObjectId } from 'mongodb';
import type { Message } from './Message';

export interface Conversation {
	_id: ObjectId;
	sessionId: string;

	title: string;
	messages: Message[];

	createdAt: Date;
	updatedAt: Date;
}
