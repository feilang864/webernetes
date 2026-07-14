---
"@ngrok/webernetes": minor
---

Expose `setTimeout`, `setInterval`, `queueMicrotask`, and their timer-clearing
counterparts on `ProcessContext` for process-owned simulated work. Process
context operations now consistently reject work after a container has been
killed, preventing late listener registration and other post-termination work
from causing unhandled exceptions.
