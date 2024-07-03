- Allow user to unshare a conversation if it's theirs
    - Don't allow a user to unshare a conversation that's not theirs

- In auth.ts, break authCondition into two: readAuthCondition and writeAuthCondition 
- After hitting Share, navigate the left pane to the new conversation.