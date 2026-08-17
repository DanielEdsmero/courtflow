# Editing the app's wording

Every piece of user-facing text outside the **courts** and **queue** panels lives in
this folder. Change a string here, save, and it changes everywhere it appears — you
never need to go hunting through the components.

## Which file do I want?

| File | What's in it |
|---|---|
| `common.js` | The brand name, buttons that appear all over (Back, Try again, Cancel), and the full-screen loading / "couldn't load" states |
| `toolbar.js` | The staff header: Staff/Preview, timer, matching style, Competitive/Casual, and every toolbar button + its hover tooltip |
| `queue.js` | The QUEUE panel — the Auto-group button and its helper text, the result line it writes, and every label on a waiting group |
| `roster.js` | The ROSTER panel — check-in box, returning-player dropdown, the Values toggle, the checked-out drawer |
| `modals.js` | Every pop-up: assign to court, finish match, check out, replace a queued player, book a rental, take a photo, display link, activity log |
| `prompts.js` | The browser confirm/alert boxes ("Start a new session?") and the red warning banners |
| `wizard.js` | The three-step "Set up open play" guide |
| `rankings.js` | Session Rankings, the in-app Leaderboard pop-up, and the all-time Rankings page |
| `auth.js` | Sign in, create account, and the access-key activation screen |
| `board.js` | The TV display and the public club board — only their messages, not the court cards |
| `settings.js` | The gear menu's toggles, and the match reveal sequence ("Matched! Going to Court 1") |
| `matching.js` | The names and descriptions of the matching styles, and the payment labels |

## How to edit

Most entries are plain text — change what's between the quotes:

```js
tryAgain: 'Try again',        →   tryAgain: 'Have another go',
```

Some are **functions**, because the sentence has something dropped into it. Keep the
`${...}` part and the backticks; change everything else freely:

```js
checkoutTitle: (name) => `Check out — ${name}`,
                       →  `Bye for now, ${name}!`
```

`${name}`, `${count}` and friends are placeholders the app fills in. If you delete one
the app still runs, that detail just stops appearing.

## Rules of thumb

- **Don't rename the labels on the left** (`tryAgain:`, `checkoutTitle:`) — those are
  what the code looks for. Only change what's on the right.
- Keep the quotes and the trailing comma.
- Apostrophes are fine inside double quotes or backticks: `"Nobody's here yet"`.
- After saving, the dev server reloads on its own.

## What is deliberately NOT here

The **courts** and **queue** panels keep their wording inline, as asked. That covers
court cards, the queue group cards, and the TV's court/queue tiles. Everything else —
including those screens' empty states and error messages — is in `board.js`.
