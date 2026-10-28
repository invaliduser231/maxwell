#!/bin/bash
set -euo pipefail

export GNUPGHOME=/tmp/gnupg

dump() {
  local file
  file="/backups/maxwell-$(date -u +%Y%m%d-%H%M%S).dump"
  key=$(find /keys -maxdepth 1 -name '*.asc' -type f | head -n 1)
  if [ -n "$key" ]; then
    mkdir -p -m 700 "$GNUPGHOME"
    pg_dump --format=custom \
      | gpg --batch --no-tty --trust-model always --recipient-file "$key" \
        --encrypt --output "$file.gpg.partial"
    mv "$file.gpg.partial" "$file.gpg"
  else
    pg_dump --format=custom --file="$file.partial"
    mv "$file.partial" "$file"
  fi
  find /backups -name 'maxwell-*.dump*' -mtime +"$KEEP_DAYS" -delete
  echo "backup written: $(basename "$file")$([ -n "$key" ] && echo .gpg)"
}

if [ "${1:-}" = "now" ]; then
  dump
  exit 0
fi

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "today $BACKUP_TIME" +%s)
  [ "$next" -le "$now" ] && next=$(date -u -d "tomorrow $BACKUP_TIME" +%s)
  echo "next backup at $(date -u -d "@$next" '+%Y-%m-%d %H:%M') UTC"
  sleep $((next - now))
  dump || echo "backup failed" >&2
done
