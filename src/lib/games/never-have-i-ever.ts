/**
 * Never Have I Ever — content pack. Each prompt is one round; both peers
 * tap "I have" or "Never" simultaneously and results reveal together.
 *
 * Keep prompts short, universally answerable, and heavier on the playful /
 * romantic / mildly-embarrassing end than the outright-explicit end — this
 * is a couples game meant to spark a story, not a confession booth.
 */

export interface NHIEPrompt {
  id: string;
  text: string;
  flavor?: string;
}

export const NHIE_DECK: NHIEPrompt[] = [
  { id: "nhie-1", text: "cried during a Pixar movie", flavor: "🎬" },
  { id: "nhie-2", text: "sent a text to the wrong person", flavor: "📱" },
  { id: "nhie-3", text: "fallen asleep on a video call", flavor: "💤" },
  { id: "nhie-4", text: "sung karaoke completely sober", flavor: "🎤" },
  { id: "nhie-5", text: "eaten cereal for dinner", flavor: "🥣" },
  { id: "nhie-6", text: "stalked an ex on social media", flavor: "🕵️" },
  { id: "nhie-7", text: "lied about my age", flavor: "🎂" },
  { id: "nhie-8", text: "danced alone in front of a mirror", flavor: "💃" },
  { id: "nhie-9", text: "pretended to laugh at a joke I didn't get", flavor: "😅" },
  { id: "nhie-10", text: "re-gifted a present", flavor: "🎁" },
  { id: "nhie-11", text: "fallen asleep in a movie theater", flavor: "🍿" },
  { id: "nhie-12", text: "gone a whole day without brushing my teeth", flavor: "🪥" },
  { id: "nhie-13", text: "ghosted someone", flavor: "👻" },
  { id: "nhie-14", text: "cried happy tears over food", flavor: "🍜" },
  { id: "nhie-15", text: "worn the same outfit two days in a row", flavor: "👕" },
  { id: "nhie-16", text: "kissed someone on the first date", flavor: "💋" },
  { id: "nhie-17", text: "written a love letter", flavor: "💌" },
  { id: "nhie-18", text: "taken a nap longer than 3 hours", flavor: "😴" },
  { id: "nhie-19", text: "gotten lost on purpose", flavor: "🧭" },
  { id: "nhie-20", text: "pretended to be sick to skip plans", flavor: "🤒" },
  { id: "nhie-21", text: "eaten straight from the peanut butter jar", flavor: "🥜" },
  { id: "nhie-22", text: "sent a screenshot to the person in it", flavor: "😳" },
  { id: "nhie-23", text: "cried at a wedding", flavor: "💍" },
  { id: "nhie-24", text: "gone skinny dipping", flavor: "🌊" },
  { id: "nhie-25", text: "read someone's diary or texts", flavor: "📖" },
  { id: "nhie-26", text: "faked being asleep to end a conversation", flavor: "🛌" },
  { id: "nhie-27", text: "eaten dessert before dinner", flavor: "🍰" },
  { id: "nhie-28", text: "told a lie that I still haven't confessed", flavor: "🙊" },
  { id: "nhie-29", text: "traveled somewhere completely alone", flavor: "✈️" },
  { id: "nhie-30", text: "written someone's name on the fogged mirror", flavor: "💭" },
  { id: "nhie-31", text: "cried in a public bathroom", flavor: "🚻" },
  { id: "nhie-32", text: "photographed my food more than 3 times in one meal", flavor: "📸" },
  { id: "nhie-33", text: "kissed someone I'd known less than an hour", flavor: "💫" },
  { id: "nhie-34", text: "sent a voice note over 3 minutes long", flavor: "🎙️" },
  { id: "nhie-35", text: "re-watched a series just for one episode", flavor: "📺" },
  { id: "nhie-36", text: "bought something and never used it", flavor: "🛍️" },
  { id: "nhie-37", text: "eaten breakfast at midnight", flavor: "🥞" },
  { id: "nhie-38", text: "believed in a conspiracy theory (even briefly)", flavor: "🛸" },
  { id: "nhie-39", text: "cried over a song lyric", flavor: "🎵" },
  { id: "nhie-40", text: "kept a childhood stuffed animal", flavor: "🧸" },
];

import { pickFromDeck } from "./shuffle";

const NHIE_DECK_ID = "nhie";

/**
 * Return the prompt for a given logical round. Weekly seeded shuffle keyed
 * on ISO-UTC week — both peers converge without coordination; deck rotates
 * fresh every Monday UTC. See `./shuffle.ts` for repeat-avoidance details.
 */
export function getNHIEPrompt(idx: number, weekSeed: number): NHIEPrompt {
  return pickFromDeck(NHIE_DECK, idx, weekSeed, NHIE_DECK_ID);
}

export const NHIE_DECK_LENGTH = NHIE_DECK.length;
