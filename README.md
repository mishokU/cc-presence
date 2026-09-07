# presence

One line in your Claude Code statusline that says you are not alone.

```
day 70 · 9 online · 4 still up · 6 waiting it out
```

"Yours" means people with a comparable streak who are in the console right now.
Not a chat, not a leaderboard, not another token-spend tracker.

[По-русски](README.ru.md)

## What leaves your machine

Exactly four fields, nothing else:

```json
{ "id": "<hex, 16 random bytes>", "streak": 70, "state": "work" | "limit", "night": true }
```

- `id` — random, generated once into `~/.claude/presence/id` (mode 0600),
  derived from nothing identifying;
- `streak` — consecutive days with at least one session;
- `state` — `limit` when the five-hour window is 95% used or more;
- `night` — a single bit: it is 23:00–06:00 where that person is. Not a timezone,
  not a clock, not an offset — just yes or no, computed on their machine.

Never sent: prompts, paths, file or repository names, model names, git branches,
cwd, OS version. Only `pingd.js` touches the network; `statusline.js` makes no
network calls at all, under any condition.

The server keeps a `Map` in memory with a 120-second TTL. No database, no disk,
no accounts. A restart means everyone reconnects within 45 seconds — presence is
ephemeral by nature.

## Install

```sh
npx cc-presence
```

It copies the runtime into `~/.claude/presence/bin`, wires up `statusLine` and
starts the pinger. If `statusLine` is already taken by your own script, it leaves
it alone and prints two lines to append. Remove everything:
`npx cc-presence uninstall`.

Other commands: `start`, `stop`, `status`.

The pinger talks to `https://presence.mybrocade.ru` by default; point it at your
own server with `PRESENCE_SERVER`. Run your own with `node server.js` (`PORT`,
default 8787).

The line is English by default; `PRESENCE_LANG=ru` or a `ru_*` locale switches it
to Russian.

## What you see

```
day 70                                             server down / nobody around
day 70 · 9 online                                  a cohort exists
day 70 · 9 online · 4 still up · 6 waiting it out  all three signals at once
```

A zero block is never printed — it disappears entirely, middle ones included.
Zero is not a neutral number, it is the message "you are alone", which is the
one thing this tool exists to prevent.

The streak is computed locally and works with zero other users and no server.
A `cohort.json` older than 5 minutes is stale and the social part goes quiet.

## Files

| | |
|---|---|
| `statusline.js` | renders the line: disk only, never throws, ~26 ms |
| `pingd.js` | every 45 s: counts the streak, talks to the server |
| `server.js` | `POST /ping`, cohorts from memory |
| `bin.js` | the `npx cc-presence` CLI |
| `dump.js` | debugging: point statusLine at it for one render, raw stdin lands in `~/.claude/presence/stdin-dump.json` |
| `test.js` | `node test.js` — the acceptance list |

Node 20+, zero runtime dependencies. Not asceticism: the statusline runs on every
render, and one `require` of a third-party package costs more than all the useful
work in that process.

## Cohort

Two people are in the same cohort when their streaks differ by no more than 25%
of the larger one, and never less than 3 days — a symmetric test, so seeing each
other is always mutual. You never count yourself.

Below 20 people online the cohort is not applied at all: splitting a small crowd
into bands leaves everyone with a zero, which is the one thing this tool exists
to prevent.

## License

MIT
