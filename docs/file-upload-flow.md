# File Upload Flow Analysis

This document explains how file uploads work in this chat-ui application.

## Overview

Files are uploaded through the frontend, converted to base64, sent via multipart/form-data to the backend, decoded back to binary, and stored in MongoDB GridFS.

---

## 1. Frontend: File Selection

Files can be uploaded through multiple methods:

| Method | Component |
|--------|-----------|
| File input button | `src/lib/components/chat/ChatInput.svelte` |
| Drag & drop | `src/lib/components/chat/FileDropzone.svelte` |
| URL fetch | `src/lib/components/chat/UrlFetchModal.svelte` |
| Clipboard paste | `src/lib/components/chat/ChatWindow.svelte` |

**Validation on drop/select:**
- MIME type must match allowed types (e.g., `image/*`, text types)
- Max file size: **10MB**

---

## 2. Frontend: Convert to Base64

When sending a message, files are converted to base64 using `src/lib/utils/file2base64.ts`:

```typescript
const file2base64 = (file: File): Promise<string> => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  // Extracts base64 portion after "data:mime;base64,"
  const base64 = dataUrl.split(",")[1];
  return base64;
};
```

This happens in `src/routes/conversation/[id]/+page.svelte`:

```typescript
const base64Files = await Promise.all(
  files.map((file) =>
    file2base64(file).then((value) => ({
      type: "base64",
      value,      // base64 string
      mime: file.type,
      name: file.name,
    }))
  )
);
```

---

## 3. Frontend: Send via FormData (multipart/form-data)

The `src/lib/utils/messageUpdates.ts` creates a `FormData` object:

```typescript
const form = new FormData();

opts.files?.forEach((file) => {
  const name = file.type + ";" + file.name;  // "base64;filename.pdf"
  form.append("files", new File([file.value], name, { type: file.mime }));
});

form.append("data", optsJSON);  // JSON with message inputs

const response = await fetch(`${base}/conversation/${conversationId}`, {
  method: "POST",
  body: form,  // sent as multipart/form-data
});
```

**Key points:**
- Files are sent as `multipart/form-data`
- The file name encodes `type;originalName` (e.g., `"base64;document.pdf"`)
- The file content is the **base64 string** (not raw binary)

---

## 4. Backend: Receive & Parse

The server endpoint `src/routes/conversation/[id]/+server.ts` handles the upload:

```typescript
const form = await request.formData();
const json = form.get("data") as string;

// Parse file entries from form
const inputFiles = await Promise.all(
  form.getAll("files")
    .filter((entry): entry is File => entry instanceof File)
    .map(async (file) => {
      const [type, ...name] = file.name.split(";");
      return {
        type: "base64" | "hash",
        value: await file.text(),  // base64 string
        mime: file.type,
        name: name.join(";"),
      };
    })
);

// Convert base64 to binary File
const b64Files = inputFiles
  .filter((file) => file.type !== "hash")
  .map((file) => {
    const blob = Buffer.from(file.value, "base64");  // Decode base64 → bytes
    return new File([blob], file.name, { type: file.mime });
  });

// Size check (10MB max)
if (b64Files.some((file) => file.size > 10 * 1024 * 1024)) {
  error(413, "File too large");
}
```

---

## 5. Backend: Store in MongoDB GridFS

Files are stored using `src/lib/server/files/uploadFile.ts`:

```typescript
export async function uploadFile(file: File, conv: Conversation): Promise<MessageFile> {
  const sha = await sha256(await file.text());  // Generate hash for dedup
  const buffer = await file.arrayBuffer();

  // Detect MIME type from file magic bytes
  const mime = await fileTypeFromBuffer(buffer).then(
    (fileType) => fileType?.mime ?? file.type
  );

  // Upload to MongoDB GridFS bucket
  const upload = collections.bucket.openUploadStream(
    `${conv._id}-${sha}`,  // Filename: conversationId-sha256hash
    { metadata: { conversation: conv._id.toString(), mime } }
  );

  upload.write(buffer);
  upload.end();

  return new Promise((resolve, reject) => {
    upload.once("finish", () =>
      resolve({ type: "hash", value: sha, mime, name: file.name })
    );
    upload.once("error", reject);
    setTimeout(() => reject(new Error("Upload timed out")), 20_000);
  });
}
```

**GridFS bucket setup** in `src/lib/server/database.ts`:

```typescript
const bucket = new GridFSBucket(db, { bucketName: "files" });
```

---

## 6. Storage: MessageFile Reference

After upload, the message stores a **hash reference** (not the file bytes):

```typescript
type MessageFile = {
  type: "hash" | "base64";  // "hash" for stored files
  name: string;
  value: string;            // SHA256 hash (for retrieval)
  mime: string;
};
```

---

## 7. Retrieval: Download Files

Files are retrieved via `src/lib/server/files/downloadFile.ts`:

```typescript
export async function downloadFile(sha256: string, convId: string): Promise<MessageFile> {
  const file = await collections.bucket
    .find({ filename: `${convId}-${sha256}` })
    .next();

  const fileStream = collections.bucket.openDownloadStream(file._id);

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    fileStream.on("data", (chunk) => chunks.push(chunk));
    fileStream.on("end", () => resolve(Buffer.concat(chunks)));
  });

  return { type: "base64", value: buffer.toString("base64"), mime, name };
}
```

---

## Summary Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. User selects file (input/drag/paste/URL)                                │
│  2. File validated (MIME type, size ≤ 10MB)                                 │
│  3. FileReader converts to base64 string                                    │
│  4. FormData created with:                                                  │
│     - files: [File("base64;name", base64Content)]                           │
│     - data: JSON({inputs, messageId, ...})                                  │
│  5. POST /conversation/{id} with multipart/form-data                        │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  6. Parse FormData, extract files                                           │
│  7. Decode base64 → Buffer (binary bytes)                                   │
│  8. Validate size again                                                     │
│  9. Generate SHA256 hash of content                                         │
│ 10. Upload to MongoDB GridFS bucket:                                        │
│     - Filename: "{conversationId}-{sha256}"                                 │
│     - Metadata: {conversation, mime}                                        │
│ 11. Return MessageFile: {type: "hash", value: sha256, ...}                  │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MONGODB GRIDFS                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  Files stored in chunks (files.files + files.chunks collections)            │
│  Retrieved by streaming from GridFS → Buffer → base64 for display           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Files Reference

| Purpose | File Path |
|---------|-----------|
| File input UI | `src/lib/components/chat/ChatInput.svelte` |
| Drag & drop | `src/lib/components/chat/FileDropzone.svelte` |
| URL fetch modal | `src/lib/components/chat/UrlFetchModal.svelte` |
| Base64 conversion | `src/lib/utils/file2base64.ts` |
| Send files with message | `src/lib/utils/messageUpdates.ts` |
| Backend endpoint | `src/routes/conversation/[id]/+server.ts` |
| Upload to GridFS | `src/lib/server/files/uploadFile.ts` |
| Download from GridFS | `src/lib/server/files/downloadFile.ts` |
| Database/bucket setup | `src/lib/server/database.ts` |
| MessageFile type | `src/lib/types/Message.ts` |

---

# Developer Q&A

## Q1: Model Selection Flow

### Where is the model stored?

**Per-conversation** - stored in `Conversation.model` field:

```typescript
// src/lib/types/Conversation.ts
export interface Conversation extends Timestamps {
  _id: ObjectId;
  model: string;  // ← Model ID stored here
  title: string;
  messages: Message[];
  // ...
}
```

### How does the frontend set the model?

1. **User's active model** is stored in settings (`Settings.activeModel`):
   - File: `src/lib/stores/settings.ts`
   - Persisted in MongoDB `settings` collection

2. **When creating a new conversation** (`src/routes/+page.svelte`):
   ```typescript
   const res = await fetch(`${base}/conversation`, {
     method: "POST",
     body: JSON.stringify({
       model: $settings.activeModel,  // ← Uses current active model
       preprompt: $settings.customPrompts[$settings.activeModel],
     }),
   });
   ```

3. **Changing model for existing conversation** (`src/lib/components/chat/ModelSwitch.svelte`):
   ```typescript
   await fetch(`${base}/conversation/${page.params.id}`, {
     method: "PATCH",
     body: JSON.stringify({ model: selectedModelId }),
   });
   ```

### How models are fetched

- Frontend fetches models via: `GET /api/v2/models`
- Backend loads from: `src/lib/server/models.ts`
- Model config comes from `MODELS` env var + `OPENAI_BASE_URL`

---

## Q2: File-to-LLM Pipeline

### After GridFS storage, how do files reach the LLM?

**chat-ui handles all file processing internally before calling your OpenAI-compatible endpoint.**

The flow:

1. **Message stored with hash references** (type: "hash", value: sha256)

2. **Before LLM call, files are downloaded from GridFS** → converted back to base64:
   ```typescript
   // src/lib/server/endpoints/preprocessMessages.ts
   async function downloadFiles(messages: Message[], convId: ObjectId) {
     return Promise.all(
       messages.map((message) =>
         Promise.all(
           (message.files ?? []).map((file) => downloadFile(file.value, convId))
         ).then((files) => ({ ...message, files }))  // Files now have base64 values
       )
     );
   }
   ```

3. **Files are then formatted for OpenAI** in `src/lib/server/endpoints/openai/endpointOai.ts`:
   ```typescript
   async function prepareMessages(messages, imageProcessor, isMultimodal) {
     return Promise.all(messages.map(async (message) => {
       if (message.from === "user" && message.files?.length > 0) {
         const { imageParts, textContent } = await prepareFiles(...);
         // Returns OpenAI-formatted message with image_url parts
       }
     }));
   }
   ```

### What format does your backend receive?

**Your `/api/v1/agent/chat/completions` endpoint receives standard OpenAI format:**

```json
{
  "model": "gpt-5.1",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "What's in this image?" },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
            "detail": "auto"
          }
        }
      ]
    }
  ]
}
```

**chat-ui converts hashes → base64 → OpenAI format before calling your endpoint.**

---

## Q3: OpenAI Multimodal Format

### Who handles the conversion?

**chat-ui handles it completely.**

The conversion happens in `src/lib/server/endpoints/openai/endpointOai.ts`:

```typescript
// Images are processed and converted to data URLs
imageParts = processedFiles.map((file) => ({
  type: "image_url" as const,
  image_url: {
    url: `data:${file.mime};base64,${file.image.toString("base64")}`,
    detail: "auto",
  },
}));
```

**Your backend receives ready-to-use OpenAI vision format** with inline base64 data URLs.

---

## Q4: Non-Image Files (PDFs, DOCX, etc.)

### Does chat-ui extract text?

**Yes, but only for plain text files.** See `src/lib/server/endpoints/openai/endpointOai.ts`:

```typescript
async function prepareFiles(imageProcessor, files, isMultimodal) {
  // Text files get their content injected into the message
  const textFiles = files.filter((file) => {
    return TEXT_MIME_ALLOWLIST.some((allowed) => {
      // Matches text/*, application/json, etc.
    });
  });

  if (textFiles.length > 0) {
    const textParts = await Promise.all(
      textFiles.map(async (file) => {
        const content = Buffer.from(file.value, "base64").toString("utf-8");
        return `<document name="${file.name}" type="${file.mime}">\n${content}\n</document>`;
      })
    );
    textContent = textParts.join("\n\n");
  }
}
```

**For PDFs and DOCX:**
- chat-ui passes them as base64 with `encoding="base64"` attribute
- **Your backend extracts text** from the base64-encoded binary content

### BINARY_DOC_ALLOWLIST includes:

From `src/lib/constants/mime.ts`:
- `application/pdf`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (.docx)
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (.xlsx)
- `application/vnd.openxmlformats-officedocument.presentationml.presentation` (.pptx)
- `application/msword` (.doc)
- `application/vnd.ms-excel` (.xls)
- `application/vnd.ms-powerpoint` (.ppt)
- `application/rtf`
- `application/epub+zip`

### TEXT_MIME_ALLOWLIST includes:

From `src/lib/constants/mime.ts`:
- `text/plain`
- `text/markdown`
- `text/csv`
- `application/json`
- `text/html`
- `text/xml`
- `application/xml`
- etc.

### Are files sent as data URLs?

**For images to OpenAI: Yes** - `data:image/jpeg;base64,...`

**For text files: No** - Content is decoded and injected as XML-tagged text:
```xml
<document name="file.txt" type="text/plain">
file content here
</document>
```

**For binary documents (PDF, DOCX, etc.): Base64 with encoding marker:**
```xml
<document name="report.pdf" type="application/pdf" encoding="base64">
JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwo...
</document>
```

Your backend should:
1. Detect the `encoding="base64"` attribute
2. Decode the base64 content
3. Extract text using appropriate library (PyPDF2, python-docx, etc.)

---

## Q5: The `/api/v2/conversations/{id}` Endpoint

### Is this a chat-ui endpoint or your backend?

**This is a chat-ui endpoint** - it's the REST API layer for the chat-ui application.

### Files involved:

```
src/routes/api/v2/[...slugs]/+server.ts  ← Elysia router entry point
src/lib/server/api/routes/groups/conversations.ts  ← Conversation handlers
```

### How it relays to your backend:

**It doesn't directly relay to `/api/v1/agent/chat/completions`.**

The actual LLM call goes through:

1. `POST /conversation/{id}` (SvelteKit route) receives the message
2. `src/routes/conversation/[id]/+server.ts` → calls `textGeneration(ctx)`
3. `src/lib/server/textGeneration/index.ts` → preprocesses messages
4. `src/lib/server/endpoints/openai/endpointOai.ts` → calls your `OPENAI_BASE_URL`

### Your backend URL configuration:

```env
OPENAI_BASE_URL=https://your-backend/api/v1/agent
```

chat-ui appends `/chat/completions` internally via the OpenAI SDK.

---

## Summary: Data Flow for File + Message

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER ACTION                                        │
│  Uploads file + types message → Submit                                       │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Browser)                                    │
│  1. file2base64() converts File → base64                                    │
│  2. Creates FormData with files + message JSON                              │
│  3. POST /conversation/{convId}                                             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   CHAT-UI BACKEND (conversation/+server.ts)                  │
│  4. Parses FormData, decodes base64 → binary                                │
│  5. Uploads to GridFS (stores sha256 hash in message.files)                 │
│  6. Saves message to conversation.messages[]                                │
│  7. Calls textGeneration(ctx)                                               │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   TEXT GENERATION PIPELINE                                   │
│  8. preprocessMessages() downloads hash files → base64                      │
│  9. prepareMessages() formats for OpenAI:                                   │
│     - Images → image_url with data:base64 inline                            │
│     - Text files → <document> XML injection                                 │
│ 10. OpenAI SDK calls OPENAI_BASE_URL/chat/completions                       │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      YOUR BACKEND                                            │
│  Receives standard OpenAI chat/completions request with:                    │
│  - Images as data:image/...;base64,... in content array                     │
│  - Text file content already decoded and injected                           │
│  - PDFs/DOCX as binary base64 (YOU must extract text)                       │
└─────────────────────────────────────────────────────────────────────────────┘
```
