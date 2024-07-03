import { error, json } from '@sveltejs/kit';
import { collections } from '$lib/server/database';
import { authCondition } from '$lib/server/auth';
import { ObjectId } from 'mongodb';
import type { Comment } from '$lib/types/Comment';
import { z } from 'zod';

export async function POST({ request, params, locals }) {
    const conversationId = new ObjectId(params.id);

    // Check if the user has access to the conversation
    const conversation = await collections.conversations.findOne({
        _id: conversationId,
        ...authCondition(locals),
    });

    if (!conversation) {
        throw error(404, 'Conversation not found');
    }

    const commentSchema = z.object({
        content: z.string().min(1),
        textQuoteSelector: z.object({
            exact: z.string(),
            prefix: z.string().optional(),
            suffix: z.string().optional(),
        }).optional(),
        textPositionSelector: z.object({
            start: z.number(),
            end: z.number(),
        }).optional(),
    });

    const body = await request.json();
    const validatedData = commentSchema.parse(body);

    const newComment: Comment = {
        _id: new ObjectId(),
        sessionId: locals.sessionId,
        userId: locals.user?._id,
        conversationId,
        content: validatedData.content,
        textQuoteSelector: validatedData.textQuoteSelector,
        textPositionSelector: validatedData.textPositionSelector,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const result = await collections.comments.insertOne(newComment);

    if (!result.acknowledged) {
        throw error(500, 'Failed to create comment');
    }

    return json({ id: newComment._id });
}

export async function PUT({ request, params, locals }) {
    const conversationId = new ObjectId(params.id);

    // Check if the user has access to the conversation
    const conversation = await collections.conversations.findOne({
        _id: conversationId,
        ...authCondition(locals),
    });
    if (!conversation) {
        throw error(404, 'Conversation not found');
    }

    const updateCommentSchema = z.object({
        commentId: z.string(),
        content: z.string().min(1),
        textQuoteSelector: z.object({
            exact: z.string(),
            prefix: z.string().optional(),
            suffix: z.string().optional(),
        }).optional(),
        textPositionSelector: z.object({
            start: z.number(),
            end: z.number(),
        }).optional(),
    });

    const body = await request.json();
    const validatedData = updateCommentSchema.parse(body);

    const commentId = new ObjectId(validatedData.commentId);

    const updateResult = await collections.comments.updateOne(
        { 
            _id: commentId, 
            conversationId,
            ...authCondition(locals)
        },
        {
            $set: {
                content: validatedData.content,
                textQuoteSelector: validatedData.textQuoteSelector,
                textPositionSelector: validatedData.textPositionSelector,
                updatedAt: new Date(),
            }
        }
    );

    if (updateResult.matchedCount === 0) {
        throw error(404, 'Comment not found or you do not have permission to update it');
    }

    if (updateResult.modifiedCount === 0) {
        throw error(500, 'Failed to update comment');
    }

    return json({ success: true });
}