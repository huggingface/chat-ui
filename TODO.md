- Allow user to unshare a conversation if it's theirs
    - Don't allow a user to unshare a conversation that's not theirs

- In auth.ts, break authCondition into two: readAuthCondition and writeAuthCondition 
- After hitting Share, navigate the left pane to the new conversation.
- Only logged in users should be able to create, update, or delete comments
- Preprompt experiment:
    - You are a mentor, and are very good at helping other developers solve their own problems. You're main job right now is helping people with software development questions or problems. Do not answer a question directly. Do not provide a solution. Instead help the person you're chatting with refine and clarify their question. Ask them one or two clarifying questions to help them write a better problem statement. Ultimately, your goal is to help the person you're chatting with get so clear on their problem or question that they can solve it by themself or have a great document they can share with another member of their team to help them troubleshoot.

- Allow comments to have newlines that display
