---
title: Features
---

# Features

A detailed overview of everything you can do as a user in Loica.

---

## Account & Authentication

### Registration
- Sign up with your name, email, and password
- Password must be at least 8 characters, contain a letter and a number, and not be a common password
- The first person to register automatically becomes the admin
- Registration can be open (self-service) or invite-only (admin creates accounts)
- Alternatively, sign in with your organization's SSO 

### Sessions
- You stay logged in for 30 days
- Changing your password invalidates all your other sessions (phone, other browsers, etc.)

### Settings (/settings)
- Change your display name and email address
- Change your password (requires your current password)
- Download your entire workspace as a ZIP file preserving your folder structure

---

## The Editor

### Writing
- Full Markdown editor that formats your text inline as you write
- Auto-save — your changes are saved automatically as you type (600ms after you stop)
- Editable document title — click the title in the navbar to rename it
- Word count and character count shown in the footer

### Toolbar
The toolbar provides quick-access buttons for formatting:

| Button | What it does |
|--------|-------------|
| **B** | Bold |
| *I* | Italic |
| ~~S~~ | Strikethrough |
| H | Highlight |
| link | Insert a link |
| H1, H2, H3, H4 | Headings |
| List icon (bullets) | Unordered list |
| List icon (numbers) | Ordered list |
| `"` | Blockquote |
| `</>` | Inline code |
| --- | Horizontal rule |
| Pencil icon | Toggle track changes mode |
| Image icon | Upload an image |

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| Cmd+B | Bold |
| Cmd+I | Italic |
| Cmd+K | Insert link |
| Cmd+` | Inline code |
| Cmd+Shift+H | Highlight |
| Cmd+Shift+C | Add a comment on selected text |
| Cmd+Shift+A | Add an insertion suggestion |
| Cmd+Shift+D | Add a deletion suggestion |
| Cmd+Shift+S | Add a substitution suggestion |
| Tab / Shift+Tab | Indent / unindent |
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |
| Ctrl+Click on a link | Open the link in a new tab |

### Spellcheck
- Spellcheck is enabled automatically using your browser's native checker
- The language is auto-detected between English and Spanish based on your document content

### Images
- Upload images via the toolbar button, by pasting from your clipboard, or by dragging a file onto the editor
- Supported formats: PNG, JPEG, GIF, WebP, SVG (max 5 MB)
- Images are automatically resized to max 1200x1200 pixels and converted to WebP for efficiency (except SVG and GIF which are kept as-is)
- Images display inline in the editor — when your cursor is away, you see the actual image; when your cursor is on the image syntax, you see the raw Markdown
- Uploaded images stay with the document when downloaded as a workspace ZIP

### Clickable Links
- Markdown links in the editor are rendered as clickable — Ctrl+Click opens them in a new tab

---

## Real-Time Collaboration

### Live Editing
- Multiple people can edit the same document at the same time
- Changes sync instantly via WebSocket
- Each collaborator's cursor is visible in real time

### Presence
- Colored dots in the navbar show who is currently viewing or editing the document
- Each person gets a unique color

### Connection Status
- A status indicator appears when your connection drops:
  - Yellow dot + "reconnecting..." — trying to reconnect
  - Red dot + "offline" — disconnected
- The indicator disappears when you're connected (no clutter)
- The app reconnects automatically after sleep/wake or network interruptions

---

## Comments & Mentions

### Creating Comments
- Select text and click the floating "+ Comment" bubble that appears, or press Cmd+Shift+C
- Comments are anchored to the selected text — they follow it even as the document changes
- If the anchored text is later deleted, the comment shows the original text in italic with a note

### Comment Threads
- Reply to any comment to create a thread
- Edit or delete your own comments
- Resolve a thread when the discussion is done (dims it in the sidebar)
- Reopen a resolved thread if needed
- Toggle showing/hiding resolved threads with the "X resolved" button

### @Mentions
- Type @ followed by a name in any comment to mention someone
- An autocomplete dropdown appears with matching users
- The mention displays as a styled @Name in the comment (not the raw markup)
- The mentioned person receives an email notification with the comment text and an "Open document" button linking directly to the document

### Review Panel
- The Review panel (right sidebar) shows all comments and suggestions sorted by their position in the document
- A badge on the panel icon shows the count of active items
- Click any comment to scroll the editor to the anchored text
- The panel auto-opens when comments or suggestions are detected, and auto-closes when they're all resolved

---

## Version History

### Automatic Snapshots
- A snapshot is automatically saved every 30 minutes during active editing
- A snapshot is also saved when the last person leaves the document

### Manual Snapshots
- Click "Save current version" in the Version History panel at any time

### Browsing Versions
- Versions are listed newest-first in the sidebar
- Each shows: timestamp, who created it, and whether it was auto or manual

### Previewing & Restoring
- Click "preview" on any version to see a word-level diff compared to the current document
  - Green highlighted text = added since that version
  - Red strikethrough text = removed since that version
  - Long unchanged sections are truncated for readability
- Click "restore" to roll back the document to that version (with a confirmation dialog)
- Restoring resets the collaborative editing state — all connected users seamlessly receive the restored content

---

## Documents & Folders

### Creating
- Click "+ New doc" to create a document (auto-generates a random 3-word name like "fox-oak-bay")
- Click the folder icon to create a new folder

### Organizing
- **Drag and drop** documents into folders, or folders into other folders
  - Visual feedback: blue ring on valid targets, red ring on invalid ones (e.g., dropping a folder into its own child)
  - Touch-friendly: requires 250ms hold before dragging starts on mobile
- **Move dialog** — use the "Move" option in the three-dot menu to pick any location in your folder tree
  - Shows the full folder hierarchy as an indented tree
  - Current location is highlighted and disabled
  - Descendants of the moving folder are disabled to prevent cycles

### File List
- Sort by name, created date, or last modified (ascending/descending)
- Starred documents always appear at the top regardless of sort order
- Recently modified documents (up to 5) shown as cards above the file list

### Actions Menu (three-dot icon on each row)
For documents:
- Star / Unstar
- Rename
- Download as .md
- Download as .pdf
- Share
- Unshare (if currently shared)
- Move
- Delete

For folders:
- Rename
- Share (workspace owners only)
- Unshare (workspace owners only)
- Move
- Delete (deletes all contents)

### Bulk Selection
- Check multiple documents via checkboxes (appear on hover)
- Bulk delete all selected documents
- Bulk remove public access from selected documents
- Click outside any row to clear selection

### Breadcrumbs
- When inside a folder or document, breadcrumb links show the folder path
- Click any ancestor folder to navigate up

---

## Search

- **Cmd+K** from any page opens the global search modal
- Full-text search across all documents you have access to (your own workspace + anything shared with you)
- Results appear live as you type with content snippets and highlighted matches
- Navigate with Arrow keys, press Enter to open, Escape to close
- Documents in other users' workspaces only appear if they've been explicitly shared with you

---

## Sharing & Collaboration

### Sharing with Specific People
- Open the Share panel from the document editor sidebar or from the three-dot menu in the file list
- Search for a user by name or email (autocomplete dropdown)
- Share with an entire group at once (dropdown of your groups)
- View all current shares and remove any of them
- An email notification is sent to the person you share with

### Public Links
- **View-only link** — anyone with the link can read the document without logging in
- **Edit link** — anyone with the link can edit the document without logging in
- **Edit with track changes link** — opens in suggestion mode so guest changes are tracked
- Copy any link with one click
- Toggle links on/off at any time

### Guest Editing (Public Links)
- Guests are assigned a random Chilean bird name as their display name (e.g., Condor, Flamingo, Perdiz)
- Guests see live cursors and can collaborate in real time
- Guests can add comments and suggestions but cannot resolve comment threads
- No login required

### Folder Sharing
- Share an entire folder (and all documents inside it) with specific users or groups
- Remove shares at any time

### Shared With Me (/shared)
- View all pending share invitations with Accept / Decline buttons
  - Separate sections for folder invitations and document invitations
- Browse accepted shared folders (grouped by workspace)
- Browse accepted shared documents
- Star shared documents
- Navigate into shared folders to view and edit documents

---

## Groups

### Managing Groups (/groups)
- Create a new group from the groups page
- View all groups you belong to with member count and your role

### Group Detail (/groups/:id)
- **Add members** by name or email (with autocomplete)
- **Admin auto-accept**: when a site admin adds someone, they join immediately with no invitation step
- **Non-admin invite**: member gets a pending invitation and an email with a "View invitation" button
- Change member roles between admin and member (admins only)
- Remove members (admins only)
- Rename the group (admins only)
- Delete the group (admins only) — revokes all folder shares via that group
- Leave the group at any time

### Notifications
- **Global banner**: when you have pending group invitations, a banner appears at the top of every page linking to /groups
- **Email**: invite emails include a "View invitation" button
- **Groups page**: pending invitations section with Accept / Decline buttons

---

## Export

### Markdown (.md)
- Download any document as a raw Markdown file
- Available from the Export panel in the editor or the three-dot menu in the file list

### Workspace ZIP
- Download your entire workspace as a ZIP from Settings
- Preserves your folder structure as directories
- Documents saved as .md files named after their titles
- Duplicate filenames within a folder get numbered suffixes: (2), (3), etc.

---

## Email Notifications

Loica sends email notifications for these events:

| Event | Who receives it | What it says |
|-------|----------------|-------------|
| Account created by admin | New user | Welcome email with temporary password |
| Password changed by admin | Affected user | New password |
| Document shared with you | Recipient | Who shared, document name |
| Folder shared with you | Recipient | Who shared, folder name |
| Group invitation (non-admin) | Invited user | Who invited, group name, "View invitation" button |
| @Mentioned in a comment | Mentioned user | Who mentioned, document name, comment text, "Open document" button |

All emails include styled HTML with the Loica branding. If the email service is not configured, notifications are logged to the server console instead.

---

## Status Bar & Footer

### Document Editor Footer
- **Left**: connection status (only shown when disconnected)
- **Center**: word count and character count (CriticMarkup syntax stripped from the count)
- **Right**: Loica version (git commit hash)

### All Pages Footer
- Shows the Loica version identifier (git commit hash from the build)

---

## Connection & Reliability

- WebSocket connection for real-time sync with automatic reconnection
- When you switch back to a tab after being away, the app refreshes data after 1.5 seconds
- Background polling every 30 seconds to keep data fresh
- If a document is restored to a previous version, all connected editors seamlessly receive the restored content
- Documents up to 5 MB in size are supported

---

## Admin Panel (/admin)

*Only visible to administrators.*

### System Dashboard
- Document count, user count, server uptime, memory usage
- Database size and WAL file size (with checkpoint button if WAL grows large)
- Disk usage pie chart (color-coded: green, amber at 75%, red at 90%)
- Project folder and source code size
- Last backup timestamp (warning if older than 24 hours)
- Expired session count with cleanup button

### Live Activity
- Active documents showing connected users (refreshed every 15 seconds)
- Recent activity feed: logins, edits, folder/document shares

### User Management
- Create new users (sends welcome email with temporary password)
- Edit name and email
- Change passwords (sends notification email)
- Promote/demote admin status
- Delete users with option to transfer their documents to another user
- Merge one user's files into another user
- Export a user's data as ZIP

### Settings
- Toggle public registration on/off
- Toggle local login page visibility (for OIDC-only deployments)

### Server Operations
- Restart all services (auto-detects when server is back and reloads the page)
