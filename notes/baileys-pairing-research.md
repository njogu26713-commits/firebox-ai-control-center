# Baileys pairing research

- Official pairing-code guide: https://baileys.wiki/authentication/pairing-code
- Official npm package: https://www.npmjs.com/package/@whiskeysockets/baileys
- Search findings show Baileys 7.x can emit 515 / `restartRequired` and the socket must be recreated; issue reference: https://github.com/WhiskeySockets/Baileys/issues/2488
- The dashboard logs showed `stream:error` code 515 and `Connection Failure`, consistent with a required socket restart rather than a valid QR being available.
- The current service waits on one socket and clears it on close but does not automatically recreate the socket or resolve pending QR waiters on restart. The next fix should treat code 515/restartRequired as reconnectable, recreate the socket, and keep the QR waiter alive across socket recreation.
