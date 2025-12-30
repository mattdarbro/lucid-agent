# iOS Spec: Mode Documents Tab

## Overview

Add a new tab to the iOS app that allows users to view and edit their mode documents. These are persistent markdown files that provide context for each chat mode.

## Why This Feature

Lucid's modes (/M, /L, /O, /P, /S) each have a specific focus, but context gets lost between conversations. Mode documents are "living documents" that maintain ongoing narrative and key information for each mode. Users can:

- See exactly what context Lucid has for each mode
- Edit and update the documents
- Keep track of their life, relationships, goals, and explorations

## Tab Design

### Tab Bar Icon
- Suggest: Document icon with a mode indicator
- Alternative: Book or journal icon
- Position: After existing tabs (to be determined)

### Main View: Document List

Display all 5 mode documents in a list:

```
┌─────────────────────────────────────┐
│ Mode Documents                    ⚙️ │
├─────────────────────────────────────┤
│                                     │
│ 📄 Me (/M)                         │
│    Your life context, challenges    │
│    Updated 2 days ago by you       │
│                                     │
│ 📄 Lucid (/L)                      │
│    Lucid's self-awareness          │
│    Updated 1 week ago by Lucid     │
│                                     │
│ 📄 Others (/O)                     │
│    People in your orbit            │
│    Updated 3 days ago by you       │
│                                     │
│ 📄 Possibilities (/P)              │
│    Paths being explored            │
│    Updated 5 days ago by Lucid     │
│                                     │
│ 📄 State (/S)                      │
│    Goals, visions, decisions       │
│    Updated 1 day ago by you        │
│                                     │
│ ℹ️ Chat mode (/C) has no document  │
│    It's designed to be ephemeral   │
│                                     │
└─────────────────────────────────────┘
```

### Document View

When tapping a document, show full markdown content with editing capability:

```
┌─────────────────────────────────────┐
│ ← Me Context              Edit  ⋮   │
├─────────────────────────────────────┤
│                                     │
│ # Matt Context (/M Mode)            │
│                                     │
│ *Last updated: Dec 30, 2025*        │
│ *Updated by: user*                  │
│                                     │
│ ---                                 │
│                                     │
│ ## Current Season                   │
│                                     │
│ Building Lucid while balancing      │
│ family and work. A season of        │
│ creation and constraint.            │
│                                     │
│ ---                                 │
│                                     │
│ ## What's On My Mind                │
│                                     │
│ - iOS updates needed                │
│ - Lucid context improvements        │
│ - Family trip planning              │
│                                     │
│ ...                                 │
│                                     │
└─────────────────────────────────────┘
```

### Edit Mode

When tapping "Edit":

```
┌─────────────────────────────────────┐
│ ← Cancel        Me Context    Save  │
├─────────────────────────────────────┤
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ # Matt Context (/M Mode)        │ │
│ │                                 │ │
│ │ *Last updated: Dec 30, 2025*    │ │
│ │ *Updated by: user*              │ │
│ │                                 │ │
│ │ ---                             │ │
│ │                                 │ │
│ │ ## Current Season               │ │
│ │                                 │ │
│ │ Building Lucid while balancing  │ │
│ │ family and work. A season of    │ │
│ │ creation and constraint.        │ │
│ │ _                               │ │
│ │                                 │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌───────────────────────────────┐   │
│ │ Markdown Preview      Toggle  │   │
│ └───────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

Options:
- Toggle between raw markdown and preview
- Auto-save drafts locally
- Save button pushes to server
- Cancel discards changes (with confirmation if changes exist)

### Version History (Optional Enhancement)

Accessible from the ⋮ menu:

```
┌─────────────────────────────────────┐
│ ← Version History        Me Context │
├─────────────────────────────────────┤
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Version 5 (current)              │ │
│ │ Dec 30, 2025 by user             │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Version 4                        │ │
│ │ Dec 28, 2025 by Lucid            │ │
│ │                       Restore ➤  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Version 3                        │ │
│ │ Dec 25, 2025 by user             │ │
│ │                       Restore ➤  │ │
│ └─────────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

## API Endpoints

All endpoints are under `/v1/mode-documents`

### List All Documents
```
GET /v1/mode-documents/:user_id

Response:
{
  "documents": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "mode": "me",
      "content": "# Matt Context...",
      "updated_at": "2025-12-30T10:00:00Z",
      "updated_by": "user",
      "version": 5
    },
    ...
  ]
}
```

### Get Single Document
```
GET /v1/mode-documents/:user_id/:mode

mode: me | lucid | others | possibilities | state

Response:
{
  "document": {
    "id": "uuid",
    "user_id": "uuid",
    "mode": "me",
    "content": "# Matt Context...",
    "updated_at": "2025-12-30T10:00:00Z",
    "updated_by": "user",
    "version": 5
  }
}
```

### Update Document
```
PUT /v1/mode-documents/:user_id/:mode

Body:
{
  "content": "# Updated content...",
  "updated_by": "user"
}

Response:
{
  "document": { ... },
  "message": "Document updated successfully"
}
```

### Get Version History
```
GET /v1/mode-documents/:user_id/:mode/history?limit=10

Response:
{
  "history": [
    {
      "id": "uuid",
      "document_id": "uuid",
      "version": 4,
      "content": "...",
      "updated_by": "lucid",
      "created_at": "2025-12-28T10:00:00Z"
    },
    ...
  ]
}
```

### Rollback to Version
```
POST /v1/mode-documents/:user_id/:mode/rollback

Body:
{
  "version": 3
}

Response:
{
  "document": { ... },
  "message": "Rolled back to version 3"
}
```

### Get Available Modes
```
GET /v1/mode-documents/modes

Response:
{
  "modes": [
    {
      "mode": "me",
      "name": "Me",
      "description": "Your life context, challenges, and growth",
      "hasDocument": true
    },
    {
      "mode": "chat",
      "name": "Chat",
      "description": "Light, ephemeral conversation",
      "hasDocument": false
    },
    ...
  ]
}
```

## Implementation Notes

### Markdown Rendering
- Use a markdown rendering library (e.g., `MarkdownUI` for SwiftUI)
- Support standard markdown: headers, lists, bold, italic, links
- Tables are a nice-to-have

### Offline Support
- Cache documents locally for offline viewing
- Queue edits when offline, sync when online
- Show sync status indicator

### Sync with Lucid Updates
- Lucid may update documents during conversations
- Pull-to-refresh to get latest
- Consider push notifications for Lucid updates (optional)

### Mode Indicator Integration
- Consider showing current mode's document status in chat view
- Quick link to edit document from mode indicator

## Data Model (iOS)

```swift
struct ModeDocument: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let mode: DocumentMode
    var content: String
    let updatedAt: Date
    let updatedBy: UpdatedBy
    let version: Int
}

enum DocumentMode: String, Codable, CaseIterable {
    case me
    case lucid
    case others
    case possibilities
    case state
}

enum UpdatedBy: String, Codable {
    case user
    case lucid
    case agent
    case system
}

struct ModeDocumentHistory: Codable, Identifiable {
    let id: UUID
    let documentId: UUID
    let version: Int
    let content: String
    let updatedBy: String
    let createdAt: Date
}
```

## Priority

**High** - This feature addresses a fundamental gap in Lucid's context awareness. Users have been experiencing the "telephone call" problem where Lucid can't see the full context.

## Dependencies

- Backend API: **Implemented** (see `/v1/mode-documents` endpoints)
- Database migration: **Implemented** (migration 034)
- Service layer: **Implemented** (`ModeDocumentService`)

## Questions for iOS Team

1. What markdown rendering library do you prefer?
2. Should edit mode be inline or a separate full-screen view?
3. How should we handle conflicts if Lucid updates while user is editing?
4. Do you want to support markdown preview toggle, or just show rendered markdown?
5. Where in the tab bar should this live?

## Mockup Notes

- Keep it simple - this is a document editor, not a full IDE
- Focus on readability of the markdown
- Make it easy to quickly scan and edit sections
- The "Updated by Lucid" indicator is important - users should know when Lucid has contributed

---

*This spec was created based on the mode documents design. The backend is fully implemented and ready for iOS integration.*
