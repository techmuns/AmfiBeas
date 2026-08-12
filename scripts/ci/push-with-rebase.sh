#!/usr/bin/env bash
# Push a data-refresh commit to main, rebasing if main moved while we worked.
#
# Every data workflow used to end in a bare `git push`, which fails outright when
# another workflow (or a human merge) has pushed since checkout — GitHub rejects
# it as non-fast-forward and the job dies with its commit stranded on the runner.
# That is how a full AMC monthly fetch (four minutes of scraping, 1,100 files
# rebuilt) was thrown away: the push lost a race with a merge two minutes
# earlier. These jobs write disjoint generated files, so rebasing and retrying is
# almost always a no-op merge; when it genuinely conflicts we stop and say so
# rather than guess which side of a generated file is correct.
#
# Usage: scripts/ci/push-with-rebase.sh [branch]   (branch defaults to main)
set -uo pipefail

BRANCH="${1:-main}"
ATTEMPTS=5

for i in $(seq 1 "$ATTEMPTS"); do
  if git push origin "HEAD:$BRANCH"; then
    echo "Pushed to $BRANCH on attempt $i."
    exit 0
  fi

  if [ "$i" -eq "$ATTEMPTS" ]; then
    echo "::error::Could not push to $BRANCH after $ATTEMPTS attempts."
    exit 1
  fi

  echo "Push rejected — $BRANCH moved. Rebasing (attempt $i of $ATTEMPTS)…"
  if ! git pull --rebase --autostash origin "$BRANCH"; then
    git rebase --abort 2>/dev/null || true
    echo "::error::Rebase onto $BRANCH hit a conflict. The refreshed data is NOT" \
         "pushed — re-run this workflow so it regenerates against current $BRANCH."
    exit 1
  fi
  sleep $((i * 5))
done
