#!/usr/bin/env bash
#
# Read-only audit of uploads/ against the references the database holds.
#
# Answers the two questions the cleanup job can't:
#
#   · which uploaded files does nothing reference any more (disk being wasted)
#   · which referenced files are gone from disk (users seeing broken images)
#
# The second one has no other detection path. cleanupOrphanUploads only looks
# in one direction — file on disk, is it referenced? — so an upload deleted by
# the pre-quarantine cleanup leaves a live document pointing at nothing and
# nobody finds out.
#
# Reference rules mirror ws/cleanup.ts exactly: documents.content, version
# history, the pdf_file column, workspace icons, and finally the Yjs binary,
# which is the actual source of truth.
#
# Touches nothing. Opens the database read-only, never writes to uploads/.
#
# Usage:
#   ./scripts/audit-uploads.sh
#
# Exit status:
#   0  no referenced file is missing
#   1  at least one referenced file is missing from disk
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${APP_DIR}/.env"

log() { echo "[$(date -Iseconds)] $*"; }

# DATA_DIR relocates the database and uploads together (app/lib/paths.server.ts),
# so read it the same way the app does before deciding where to look.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

DATA_DIR="${DATA_DIR:-$APP_DIR}"
DB_PATH="${DATA_DIR}/app.db"
UPLOADS_DIR="${DATA_DIR}/uploads"

# An upload must be unreferenced for this long before it's worth reporting —
# same window cleanupOrphanUploads waits, for the same reason: the markdown
# projection lags, so a fresh file can look orphaned while it's in active use.
MIN_ORPHAN_AGE_DAYS="${MIN_ORPHAN_AGE_DAYS:-30}"

[[ -f "$DB_PATH" ]] || { log "ERROR: no database at ${DB_PATH}"; exit 2; }
[[ -d "$UPLOADS_DIR" ]] || { log "ERROR: no uploads directory at ${UPLOADS_DIR}"; exit 2; }

q() { sqlite3 -readonly "$DB_PATH" "$1"; }

REF=$(mktemp); FILES=$(mktemp); UNREF=$(mktemp); MISSING=$(mktemp)
trap 'rm -f "$REF" "$FILES" "$UNREF" "$MISSING"' EXIT

# ─── Referenced names ─────────────────────────────────────
# Markdown and icons carry the name inside a /api/uploads/<name> URL; pdf_file
# stores the bare filename.
{
  q "SELECT content FROM documents;"
  q "SELECT content FROM document_versions;"
  q "SELECT icon FROM workspaces WHERE icon IS NOT NULL;"
} | grep -oE '/api/uploads/[^ )"'"'"']+' | sed 's|.*/||' > "$REF"

q "SELECT pdf_file FROM documents WHERE pdf_file IS NOT NULL AND length(pdf_file) > 0;" >> "$REF"
sort -u -o "$REF" "$REF"

# Files only, depth 1 — skips uploads/.quarantine/ and its contents.
find "$UPLOADS_DIR" -maxdepth 1 -type f -printf '%f\n' | sort > "$FILES"

comm -23 "$FILES" "$REF" > "$UNREF"
comm -13 "$FILES" "$REF" > "$MISSING"

log "$(wc -l < "$FILES") file(s) on disk, $(wc -l < "$REF") name(s) referenced"

# ─── Referenced but gone ──────────────────────────────────
# Reported first: this is the one that costs a user something right now.
MISSING_COUNT=$(wc -l < "$MISSING")
if [[ "$MISSING_COUNT" -gt 0 ]]; then
  log "MISSING — referenced but absent from disk (${MISSING_COUNT}):"
  while read -r name; do
    esc="${name//\'/\'\'}"
    # Which reference survived matters more than the count. A live document
    # means someone is looking at a broken image today; version history alone
    # means the damage only surfaces if that version is ever restored.
    live=$(q "SELECT COUNT(*) FROM documents WHERE content LIKE '%${esc}%' OR pdf_file = '${esc}';")
    icons=$(q "SELECT COUNT(*) FROM workspaces WHERE icon LIKE '%${esc}%';")
    docs=$(q "SELECT group_concat(DISTINCT document_id) FROM document_versions WHERE content LIKE '%${esc}%';")

    if [[ "$live" -gt 0 ]]; then
      where="LIVE — ${live} document(s)"
    elif [[ "$icons" -gt 0 ]]; then
      where="workspace icon"
    else
      where="version history only, docs: ${docs:-unknown}"
    fi
    echo "  ${name}  ${where}"
  done < "$MISSING"
else
  log "MISSING — none. Every referenced upload is on disk."
fi

# ─── On disk, unreferenced ────────────────────────────────
# The Yjs binary is the last gate: image src attributes live in it as plain
# UTF-8, so a hex substring search finds them without decoding every document.
# Byte alignment isn't enforced by instr(), so a match can be spurious — that
# errs toward calling a file live, which is the safe direction for a report
# whose only use is deciding what to delete.
yjs_has() {
  local hex
  hex=$(printf '%s' "$1" | od -An -tx1 | tr -d ' \n' | tr 'a-f' 'A-F')
  q "SELECT EXISTS(
       SELECT 1 FROM documents WHERE yjs_state IS NOT NULL AND instr(hex(yjs_state), '${hex}') > 0
       UNION ALL
       SELECT 1 FROM document_versions WHERE yjs_state IS NOT NULL AND instr(hex(yjs_state), '${hex}') > 0
     );"
}

now=$(date +%s)
orphans=0
while read -r name; do
  [[ -n "$name" ]] || continue
  mtime=$(stat -c %Y "${UPLOADS_DIR}/${name}" 2>/dev/null) || continue
  age=$(( (now - mtime) / 86400 ))
  [[ "$age" -ge "$MIN_ORPHAN_AGE_DAYS" ]] || continue
  [[ "$(yjs_has "$name")" == "0" ]] || continue
  size=$(du -h "${UPLOADS_DIR}/${name}" | cut -f1)
  echo "  ${name}  ${size}  ${age}d old"
  orphans=$((orphans + 1))
done < "$UNREF"

if [[ "$orphans" -gt 0 ]]; then
  log "ORPHANED — unreferenced for over ${MIN_ORPHAN_AGE_DAYS} days (${orphans}), listed above"
else
  log "ORPHANED — none older than ${MIN_ORPHAN_AGE_DAYS} days."
fi

[[ "$MISSING_COUNT" -eq 0 ]]
