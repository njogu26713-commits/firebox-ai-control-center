# Baileys pairing research

- Official pairing-code guide: https://baileys.wiki/authentication/pairing-code
- Official npm package: https://www.npmjs.com/package/@whiskeysockets/baileys
- Search findings show Baileys 7.x can emit 515 / `restartRequired` and the socket must be recreated; issue reference: https://github.com/WhiskeySockets/Baileys/issues/2488
- The dashboard logs showed `stream:error` code 515 and `Connection Failure`, consistent with a required socket restart rather than a valid QR being available.
- The service now treats non-logout close events, including code 515/restartRequired, as reconnectable; it recreates the socket with exponential backoff, preserves pending QR waiters across socket replacement, restores persisted auth state at process startup, and closes cleanly on Railway termination signals.
