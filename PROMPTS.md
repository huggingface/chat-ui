# Prompt templates

These are the templates used to format the conversation history for different models used in HuggingChat. Set them in your `.env.local` [like so](https://github.com/huggingface/chat-ui#chatprompttemplate).

## Llama 2

```env
<s>[INST] <<SYS>>\n{{preprompt}}\n<</SYS>>\n\n{{#each messages}}{{#ifUser}}{{content}} [/INST] {{/ifUser}}{{#ifAssistant}}{{content}} </s><s>[INST] {{/ifAssistant}}{{/each}}
```

## CodeLlama

```env
<s>[INST] <<SYS>>\n{{preprompt}}\n<</SYS>>\n\n{{#each messages}}{{#ifUser}}{{content}} [/INST] {{/ifUser}}{{#ifAssistant}}{{content}} </s><s>[INST] {{/ifAssistant}}{{/each}}
```

## Falcon

```env
System: {{preprompt}}\nUser:{{#each messages}}{{#ifUser}}{{content}}\nFalcon:{{/ifUser}}{{#ifAssistant}}{{content}}\nUser:{{/ifAssistant}}{{/each}}
```

## Mistral

```env
<s>{{#each messages}}{{#ifUser}}[INST] {{#if @first}}{{#if @root.preprompt}}{{@root.preprompt}}\n{{/if}}{{/if}} {{content}} [/INST]{{/ifUser}}{{#ifAssistant}}{{content}}</s> {{/ifAssistant}}{{/each}}
```

## Zephyr

```env
<|system|>\n{{preprompt}}</s>\n{{#each messages}}{{#ifUser}}<|user|>\n{{content}}</s>\n<|assistant|>\n{{/ifUser}}{{#ifAssistant}}{{content}}</s>\n{{/ifAssistant}}{{/each}}
```

## IDEFICS

```env
{{#each messages}}{{#ifUser}}User: {{content}}{{/ifUser}}<end_of_utterance>\nAssistant: {{#ifAssistant}}{{content}}\n{{/ifAssistant}}{{/each}}
```

## OpenChat

```env
<s>{{#each messages}}{{#ifUser}}GPT4 User: {{#if @first}}{{#if @root.preprompt}}{{@root.preprompt}}\n{{/if}}{{/if}}{{content}}<|end_of_turn|>GPT4 Assistant: {{/ifUser}}{{#ifAssistant}}{{content}}<|end_of_turn|>{{/ifAssistant}}{{/each}}
```

## Mixtral

```env
<s> {{#each messages}}{{#ifUser}}[INST]{{#if @first}}{{#if @root.preprompt}}{{@root.preprompt}}\n{{/if}}{{/if}} {{content}} [/INST]{{/ifUser}}{{#ifAssistant}} {{content}}</s> {{/ifAssistant}}{{/each}}
```

## ChatML

```env
{{#if @root.preprompt}}<|im_start|>system\n{{@root.preprompt}}<|im_end|>\n{{/if}}{{#each messages}}{{#ifUser}}<|im_start|>user\n{{content}}<|im_end|>\n<|im_start|>assistant\n{{/ifUser}}{{#ifAssistant}}{{content}}<|im_end|>\n{{/ifAssistant}}{{/each}}
```

## CodeLlama 70B

```env
<s>{{#if @root.preprompt}}Source: system\n\n {{@root.preprompt}} <step> {{/if}}{{#each messages}}{{#ifUser}}Source: user\n\n {{content}} <step> {{/ifUser}}{{#ifAssistant}}Source: assistant\n\n {{content}} <step> {{/ifAssistant}}{{/each}}Source: assistant\nDestination: user\n\n ``
```

## Gemma

```env
{{#each messages}}{{#ifUser}}<start_of_turn>user\n{{#if @first}}{{#if @root.preprompt}}{{@root.preprompt}}\n{{/if}}{{/if}}{{content}}<end_of_turn>\n<start_of_turn>model\n{{/ifUser}}{{#ifAssistant}}{{content}}<end_of_turn>\n{{/ifAssistant}}{{/each}}
```
