# Mini Date Cards — seed prompt pool

Draft seed of 25 prompts for AC6.1 (see `watch-together-phase2.md`). The Mini
Date Cards feature specialist will import these into `src/lib/date-cards.ts`.

## Tone

Two-person watch-together, mostly couples or close friends. Prompts fire at
natural breaks (boring scenes / silence), not randomly. Aim for **playful,
low-stakes, quick-to-answer** — a good prompt takes 15–30 seconds to answer,
not five minutes. Nothing accusatory, nothing that requires research, nothing
NSFW.

Content categories (roughly balanced across the 25):

- **Silly / hypothetical** (would-you-rather, absurd choices)
- **Getting-to-know** (favorite X, first Y, embarrassing Z)
- **Movie-adjacent** (react to the thing you're watching)
- **Nostalgia / childhood**
- **Small confessions** (guilty pleasures, weird habits)

## The prompts

Each row: `id` (stable, used for analytics), `text` (verbatim card copy),
`category` (helps the specialist round-robin without repeating a category
twice in a row).

| id  | text                                                                                       | category      |
| --- | ------------------------------------------------------------------------------------------ | ------------- |
| 1   | Would you rather live inside this movie for a week, or the last one we watched together?   | movie         |
| 2   | Which character on-screen right now do you most want to be friends with, and why?          | movie         |
| 3   | What's the most embarrassing song still on your most-played?                               | confession    |
| 4   | If you could steal one talent from anyone (real or fictional), what would it be?           | hypothetical  |
| 5   | What's a food you pretended to like as a kid to seem cool?                                 | nostalgia     |
| 6   | If we had to swap phones for a day, what's the first thing you'd panic about?              | silly         |
| 7   | What's your weirdest small joy — the tiny thing that unreasonably lifts your day?          | getting-to-know |
| 8   | Which scene from any movie makes you cry every single time?                                | movie         |
| 9   | If you had to give up one for a year: coffee, dessert, or spicy food?                      | hypothetical  |
| 10  | What's the last thing you Googled that you'd be mildly embarrassed to say out loud?        | confession    |
| 11  | Favorite childhood cartoon — and be honest, do you still watch it?                         | nostalgia     |
| 12  | What household chore secretly makes you feel powerful when you finish it?                  | silly         |
| 13  | What's a compliment you got once that you still think about?                               | getting-to-know |
| 14  | If you could remove one word from the English language, what goes?                         | hypothetical  |
| 15  | What movie do you think is way overrated? No judgment. Probably.                           | movie         |
| 16  | What's a fear you had as a kid that seems ridiculous now?                                  | nostalgia     |
| 17  | If you had to speak in movie quotes for a whole day, which movie do you pick?              | movie         |
| 18  | What's a small thing you're irrationally picky about?                                      | confession    |
| 19  | If our roles switched right now — you were the host and I was watching — what'd you queue? | movie         |
| 20  | What's a song you know every word of but would never admit to?                             | confession    |
| 21  | Would you rather always be 10 minutes late, or 20 minutes early, forever?                  | hypothetical  |
| 22  | What's a hobby you'd start tomorrow if you had unlimited free time?                        | getting-to-know |
| 23  | What smell instantly takes you back to a specific place?                                   | nostalgia     |
| 24  | What's the pettiest hill you're willing to die on?                                         | silly         |
| 25  | If we made a two-person movie about this exact evening, what's the title?                  | movie         |

## Notes for the specialist

- The specialist owns the actual TS shape — `{ id: number; text: string; category: string }[]` is fine.
- Card selection should avoid repeating a category twice in a row and never repeat a card within a session (fine to reset per room).
- No i18n on this pass — English only. Adding a locale key later is a schema change, not a copy change.
- Category counts (should each be at least 3): movie 7, hypothetical 4, confession 4, nostalgia 4, silly 3, getting-to-know 3.
