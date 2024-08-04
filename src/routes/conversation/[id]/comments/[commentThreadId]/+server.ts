import { error, json } from '@sveltejs/kit';
import { collections } from '$lib/server/database';
import { ObjectId } from 'mongodb';
import { authCondition, viewConversationAuthCondition } from '$lib/server/auth';
import type { Comment, CommentThread, DisplayCommentThread } from '$lib/types/Comment';
import { z } from 'zod';

// Right now, this deletes an entire comment thread.
// TODO: implement deletion of individual comments on a thread
export async function DELETE({ params, locals }) {
    const conversationId = new ObjectId(params.id);
    const commentThreadId = new ObjectId(params.commentThreadId);

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

export async function POST({ request, params, locals }) {
    const conversationId = new ObjectId(params.id);
    const commentThreadId = new ObjectId(params.commentThreadId);

    // Check if the user has read access to the conversation
    const conversation = await collections.conversations.findOne({
        _id: conversationId,
        ...viewConversationAuthCondition(locals),
    });

    if (!conversation) {
        throw error(404, 'Conversation not found');
    }

    // Check if the comment thread exists
    const existingThread = await collections.commentThreads.findOne({
        _id: commentThreadId,
        conversationId
    });

    if (!existingThread) {
        throw error(404, 'Comment thread not found');
    }

    // Check if the user is logged in. Only logged in users can create a comment.
    if (!locals.user) {
        throw error(401, 'You must be logged in to create a comment');
    }

    const commentSchema = z.object({
        content: z.string().min(1),
    });

    const body = await request.json();
    const validatedData = commentSchema.parse(body);

    const newComment: Comment = {
        _id: new ObjectId(),
        userId: locals.user?._id,
        
        content: validatedData.content,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    
    const result = await collections.commentThreads.updateOne(
        { _id: commentThreadId },
        { $push: { comments: newComment } }
    );
    
    if (result.modifiedCount === 0) {
        throw error(500, 'Failed to add comment to thread');
    }
    
    if (!result.acknowledged) {
        throw error(500, 'Failed to create comment');
    }

    return json({ id: newComment._id});
}