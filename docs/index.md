---
layout: home

hero:
  name: Loica
  text: Collaborative Markdown Editor
  tagline: A self-hosted, real-time collaborative editor with workspaces, sharing, and version history. Named after the Loica, a Chilean bird.
  image:
    light: /loica-icon.png
    dark: /loica-icon-dark.png
    alt: Loica
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Deploy
      link: /deployment

features:
  - title: Real-Time Collaboration
    details: Multiple users edit simultaneously with live cursors and presence indicators, powered by Yjs CRDTs and WebSocket sync.
  - title: Workspaces & Folders
    details: Organize documents in personal or team workspaces with nested folders, drag-and-drop, and bulk operations.
  - title: Sharing & Permissions
    details: Share documents and folders with specific users, groups, or via public links. Role-based access with owner, editor, and viewer roles.
  - title: Version History
    details: Automatic snapshots every 30 minutes plus manual saves. Preview word-level diffs and restore any version.
  - title: Comments & Track Changes
    details: Anchored comments with threads and @mentions. Suggestion mode with accept/reject workflow via CriticMarkup.
  - title: Self-Hosted & Private
    details: SQLite database, no external services required. Deploy on any Linux server with Bun, Caddy, and systemd.
---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Framework | React Router 7 (SSR) |
| UI | React 19 + Tailwind CSS 4 |
| Editor | ProseMirror + Markdown |
| Real-time sync | Yjs (CRDT) + WebSocket |
| Database | SQLite (WAL mode) via better-sqlite3 |
| Auth | Argon2 hashing, cookie-based sessions |
| Build | Vite 6 + TypeScript (strict) |

## Architecture

Loica runs two processes sharing one SQLite database:

1. **Web server** — React Router 7 SSR app handling all HTTP requests, page rendering, and form actions
2. **WebSocket server** — Standalone Yjs CRDT sync with awareness/presence protocol

Both must be running for real-time collaboration to work. In production, a reverse proxy (Caddy or nginx) sits in front for TLS termination and WebSocket routing.
