# Git Hooks

Run `npm run setup:githooks` once per clone to activate hooks from this folder.

Current hook:

- `pre-push`: rebuilds `public/downloads/controller-offline.zip` and blocks the push if the ZIP changed and is not committed.
