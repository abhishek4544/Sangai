/**
 * Story Time — cooperative Mad-Libs-style couples game.
 *
 * Each story is a template with 4 blanks. Partners alternate filling blanks
 * (A / B / A / B). Every blank has 4 handpicked options so we stay on the
 * same "pick from a grid" pattern as the other games — no text input, no
 * moderation surface. Once all 4 are filled, the completed story reveals
 * with the couple's choices highlighted.
 *
 * Deck ordering comes from the weekly shuffle (`./shuffle.ts`) so both peers
 * see the same story at the same `roundIdx` and the deck rotates fresh
 * every Monday UTC.
 */

import { pickFromDeck } from "./shuffle";

export interface StoryBlank {
  /** Short label shown above the option grid, e.g. "a silly place". */
  label: string;
  /** Exactly 4 options; kept ≤ 22 chars each so the grid buttons stay tidy. */
  options: [string, string, string, string];
}

export interface StoryCard {
  id: string;
  /** Template with `{0}` … `{3}` placeholders for the four blanks. */
  template: string;
  /** Ordered blanks; blanks[i] fills placeholder `{i}`. */
  blanks: [StoryBlank, StoryBlank, StoryBlank, StoryBlank];
  flavor?: string;
}

const STORY_DECK_ID = "story-time";

export const STORY_DECK: StoryCard[] = [
  {
    id: "story-first-date",
    flavor: "💫",
    template:
      "On our first date we went to {0} and immediately {1}. Halfway through, a wild {2} showed up. We spent the rest of the night {3}.",
    blanks: [
      {
        label: "a wildly wrong location",
        options: ["a laundromat", "an abandoned zoo", "Costco at closing", "a haunted diner"],
      },
      {
        label: "did something regrettable",
        options: ["cried a little", "started slow-dancing", "spilled everything", "lost a shoe"],
      },
      {
        label: "an unexpected guest",
        options: ["raccoon in a top hat", "opera-singing goose", "very confused dog", "the mailman"],
      },
      {
        label: "the rest of the night",
        options: ["arguing about pizza", "on a rooftop", "planning a heist", "eating cereal"],
      },
    ],
  },
  {
    id: "story-honeymoon",
    flavor: "🏝️",
    template:
      "For our honeymoon we chose {0} because we heard the {1} were amazing. On day two, we accidentally {2}. We came home with {3}.",
    blanks: [
      {
        label: "the destination",
        options: ["a submarine", "rural Iceland", "a cruise ship in Ohio", "Antarctica"],
      },
      {
        label: "what we came for",
        options: ["hot springs", "karaoke bars", "penguins", "gelato flavors"],
      },
      {
        label: "the mishap",
        options: ["adopted a llama", "joined a cult", "won a talent show", "ate the wrong berry"],
      },
      {
        label: "our souvenir",
        options: ["matching tattoos", "a stolen towel", "a lifelong friend", "no memory of Tuesday"],
      },
    ],
  },
  {
    id: "story-heist",
    flavor: "🕵️",
    template:
      "We finally pulled off the great {0} heist. My job was to {1} while you handled the {2}. In the end, we escaped by {3}.",
    blanks: [
      {
        label: "target of the heist",
        options: ["cheesecake", "royal duckling", "grandma's diary", "TV remote"],
      },
      {
        label: "my job",
        options: ["distract with jazz", "cry theatrically", "flirt with the guard", "eat the evidence"],
      },
      {
        label: "your job",
        options: ["laser grid", "the getaway ferret", "a secret passcode", "the vibes"],
      },
      {
        label: "the escape",
        options: ["on rollerblades", "in a hot-air balloon", "via a kids' slide", "riding a Roomba"],
      },
    ],
  },
  {
    id: "story-apartment",
    flavor: "🏠",
    template:
      "Our first apartment together had {0} in the kitchen and {1} in the bathroom. The neighbor was famously {2}. We finally moved out after {3}.",
    blanks: [
      {
        label: "kitchen feature",
        options: ["a wild raccoon", "no floor", "a chandelier", "a suspicious hum"],
      },
      {
        label: "bathroom feature",
        options: ["a tiny frog", "confessions written on walls", "a hot tub", "one lonely toilet"],
      },
      {
        label: "the neighbor",
        options: ["a retired magician", "always yodeling", "definitely a ghost", "our future best friend"],
      },
      {
        label: "the last straw",
        options: ["the pigeon uprising", "one too many fires", "landlord vanished", "found buried treasure"],
      },
    ],
  },
  {
    id: "story-restaurant",
    flavor: "🍜",
    template:
      "We opened a restaurant that only served {0}. The theme was strictly {1}. Critics said the vibe was {2}. It closed after we {3}.",
    blanks: [
      {
        label: "the menu",
        options: ["breakfast at midnight", "one giant meatball", "soup, always soup", "colorful jello"],
      },
      {
        label: "the theme",
        options: ["pirate karaoke", "medieval brunch", "haunted picnic", "spy dinner club"],
      },
      {
        label: "critic review",
        options: ["dangerously cozy", "confusing and loud", "surprisingly emotional", "cursed but great"],
      },
      {
        label: "the closing",
        options: ["ran off to Bali", "opened a farm", "started a band", "moved to space"],
      },
    ],
  },
  {
    id: "story-time-travel",
    flavor: "🕰️",
    template:
      "We time-traveled to {0} and immediately got into trouble for {1}. We survived thanks to {2}. We got home by {3}.",
    blanks: [
      {
        label: "the era",
        options: ["Ancient Rome", "1997", "the far future", "the disco era"],
      },
      {
        label: "the crime",
        options: ["kissing in public", "showing an iPhone", "singing a Taylor Swift song", "asking for wifi"],
      },
      {
        label: "what saved us",
        options: ["your terrible Latin", "a pack of gum", "a very charming smile", "sheer luck"],
      },
      {
        label: "how we escaped",
        options: ["a mysterious portal", "hitching with a bard", "hiding in a barrel", "a really good nap"],
      },
    ],
  },
];

export function getStoryCard(idx: number, weekSeed: number): StoryCard {
  return pickFromDeck(STORY_DECK, idx, weekSeed, STORY_DECK_ID);
}

export const STORY_DECK_LENGTH = STORY_DECK.length;

/**
 * Fill the template's `{0}` … `{3}` placeholders with the chosen options.
 * Returns a segment list so the renderer can style the couple's picks
 * distinctly from the surrounding narration.
 */
export type StorySegment =
  | { kind: "text"; value: string }
  | { kind: "blank"; blankIdx: number; value: string };

export function renderStory(
  card: StoryCard,
  picks: readonly (number | null)[],
): StorySegment[] {
  const segments: StorySegment[] = [];
  const pattern = /\{(\d+)\}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(card.template)) !== null) {
    if (match.index > cursor) {
      segments.push({
        kind: "text",
        value: card.template.slice(cursor, match.index),
      });
    }
    const blankIdx = parseInt(match[1], 10);
    const pickIdx = picks[blankIdx];
    const value =
      pickIdx == null
        ? `___`
        : card.blanks[blankIdx].options[pickIdx];
    segments.push({ kind: "blank", blankIdx, value });
    cursor = match.index + match[0].length;
  }
  if (cursor < card.template.length) {
    segments.push({ kind: "text", value: card.template.slice(cursor) });
  }
  return segments;
}
