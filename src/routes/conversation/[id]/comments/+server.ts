import { error, json } from '@sveltejs/kit';
import { collections } from '$lib/server/database';
import { authCondition, viewConversationAuthCondition } from '$lib/server/auth';
import { ObjectId } from 'mongodb';
import type { CommentThread, DisplayCommentThread } from '$lib/types/Comment';
import { z } from 'zod';

export async function POST({ request, params, locals }) {
    const conversationId = new ObjectId(params.id);

    // Check if the user has read access to the conversation
    const conversation = await collections.conversations.findOne({
        _id: conversationId,
        ...viewConversationAuthCondition(locals),
    });

    if (!conversation) {
        throw error(404, 'Conversation not found');
    }

    // Check if the user is logged in. Only logged in users can create a comment.
    if (!locals.user) {
        throw error(401, 'You must be logged in to create a comment');
    }

    const commentThreadSchema = z.object({
        comments: z.array(z.object({
            content: z.string().min(1),
        })),
        textQuoteSelector: z.object({
            exact: z.string(),
            prefix: z.string().optional(),
            suffix: z.string().optional(),
        }),
        textPositionSelector: z.object({
            start: z.number(),
            end: z.number(),
        }),
    });

    const body = await request.json();
    const validatedData = commentThreadSchema.parse(body);

    const newCommentThread: CommentThread = {
        _id: new ObjectId(),
        conversationId,
        userId: locals.user?._id,
        comments: validatedData.comments.map(comment => ({
            _id: new ObjectId(),
            sessionId: locals.sessionId,
            userId: locals.user?._id,
            content: comment.content,
            createdAt: new Date(),
            updatedAt: new Date(),
        })),
        textQuoteSelector: validatedData.textQuoteSelector,
        textPositionSelector: validatedData.textPositionSelector,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const result = await collections.commentThreads.insertOne(newCommentThread);

    if (!result.acknowledged) {
        throw error(500, 'Failed to create comment');
    }

    return json({ id: newCommentThread._id, userId: newCommentThread.userId });
}

export async function PUT({ request, params, locals }) {
    const conversationId = new ObjectId(params.id);

    // Check if the user has read access to the conversation
    const conversation = await collections.conversations.findOne({
        _id: conversationId,
        ...viewConversationAuthCondition(locals),
    });
    if (!conversation) {
        throw error(404, 'Conversation not found');
    }

    const updateCommentThreadSchema = z.object({
        commentThreadId: z.string(),
        comments: z.array(z.object({
            _id: z.string().optional(),
            content: z.string().min(1),
        })),
        textQuoteSelector: z.object({
            exact: z.string(),
            prefix: z.string().optional(),
            suffix: z.string().optional(),
        }),
        textPositionSelector: z.object({
            start: z.number(),
            end: z.number(),
        }),
    });

    const body = await request.json();
    const validatedData = updateCommentThreadSchema.parse(body);

    const commentThreadId = new ObjectId(validatedData.commentThreadId);

    // Check if the user has write access to the comment
    const updateResult = await collections.commentThreads.updateOne(
        { 
            _id: commentThreadId, 
            conversationId,
            userId: locals.user?._id,
        },
        {
            $set: {
                comments: validatedData.comments.map(comment => ({
                    _id: comment._id ? new ObjectId(comment._id) : new ObjectId(),
                    sessionId: locals.sessionId,
                    userId: locals.user?._id,
                    content: comment.content,
                    createdAt: comment._id ? new Date(0) : new Date(), // Use existing date for old comments, new date for new ones
                    updatedAt: new Date(),
                })),
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

export async function GET({ params, locals }) {
    const conversationId = new ObjectId(params.id);

    // Check if the user has read access to the conversation
    const conversation = await collections.conversations.findOne({
        _id: conversationId,
        ...viewConversationAuthCondition(locals),
    });

    if (!conversation) {
        throw error(404, 'Conversation not found');
    }

    // Fetch all comment threads for the conversation and join with users table
    const commentThreads = await collections.commentThreads.aggregate([
        { $match: { conversationId } },
        { $sort: { 'textPositionSelector.start': 1 } },
        {
            $lookup: {
                from: 'users',
                localField: 'comments.userId',
                foreignField: '_id',
                as: 'users'
            }
        },
        {
            $project: {
                _id: 1,
                conversationId: 1,
                comments: {
                    $map: {
                        input: '$comments',
                        as: 'comment',
                        in: {
                            _id: '$$comment._id',
                            sessionId: '$$comment.sessionId',
                            userId: '$$comment.userId',
                            content: '$$comment.content',
                            createdAt: '$$comment.createdAt',
                            updatedAt: '$$comment.updatedAt',
                            username: {
                                $let: {
                                    vars: {
                                        user: {
                                            $arrayElemAt: [
                                                {
                                                    $filter: {
                                                        input: '$users',
                                                        cond: { $eq: ['$$this._id', '$$comment.userId'] }
                                                    }
                                                },
                                                0
                                            ]
                                        }
                                    },
                                    in: '$$user.name'
                                }
                            }
                        }
                    }
                },
                textQuoteSelector: 1,
                textPositionSelector: 1,
                createdAt: 1,
                updatedAt: 1,
                userId: 1,
                userName: 1,
                isPending: { $literal: false }
            }
        }
    ]).toArray() as DisplayCommentThread[];

    return json(commentThreads);
}