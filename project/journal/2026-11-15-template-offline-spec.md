# The Template browser goes offline during play

The seated shared-page fixture uses Chromium's actual offline state,
checks navigator.onLine is false and sees the offline-play card. Going
online clears the card and a new chat line reaches the other page.
Only the injected network's console failures are admitted; uncaught page
errors remain failures.

Bodies/chat, real drop and offline recovery pass together in 25.2 s.
