import { error, json } from '@sveltejs/kit';
import { collections } from '$lib/server/database';
import { authCondition } from '$lib/server/auth';
import { ObjectId } from 'mongodb';

export async function DELETE({ params, locals }) {
    const conversationId = new ObjectId(params.id);
    const commentThreadId = new ObjectId(params.commentId);

    // Check if the user has owner access to the conversation
    const conversation = await collections.conversations.findOne({
        _id: conversationId,
        ...authCondition(locals),
    });
    if (!conversation) {
        throw error(404, 'Conversation not found');
    }

    const deleteResult = await collections.commentThreads.deleteOne({
        _id: commentThreadId,
        conversationId,
        ...authCondition(locals)
    });

    if (deleteResult.deletedCount === 0) {
        throw error(404, 'Comment thread not found or you do not have permission to delete it');
    }

    return json({ success: true });
}