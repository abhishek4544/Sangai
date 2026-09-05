/**
 * Truth or Dare deck. Two piles, id-keyed like `date-cards.ts` so the wire
 * only carries the short id (deck can grow without an envelope-version bump;
 * unknown ids on the receiver fall back to "the other version has a card
 * yours doesn't yet — hit Next").
 *
 * Content skewed to WARM / PLAYFUL, not risqué — this is a couples app used
 * over a movie night, not a party game. Dares are things you can actually
 * do in front of a webcam without props.
 */
export type TodType = "truth" | "dare";

export interface TodCard {
  id: string;
  type: TodType;
  text: string;
}

export const TRUTHS: TodCard[] = [
  { id: "t01", type: "truth", text: "What's the last white lie you told me?" },
  { id: "t02", type: "truth", text: "What do I do that always makes you laugh?" },
  { id: "t03", type: "truth", text: "What's a compliment you've been holding back?" },
  { id: "t04", type: "truth", text: "What's your favorite memory of us?" },
  { id: "t05", type: "truth", text: "What's a small thing you find attractive about me?" },
  { id: "t06", type: "truth", text: "What's a fear you've never told me?" },
  { id: "t07", type: "truth", text: "What's the best gift I've ever given you?" },
  { id: "t08", type: "truth", text: "What's one thing you'd change about our routine?" },
  { id: "t09", type: "truth", text: "What did you first notice about me?" },
  { id: "t10", type: "truth", text: "What's something you love that I don't know?" },
  { id: "t11", type: "truth", text: "What's a habit of mine you secretly enjoy?" },
  { id: "t12", type: "truth", text: "When did you last feel proud of me?" },
  { id: "t13", type: "truth", text: "What's a place you dream about taking me to?" },
  { id: "t14", type: "truth", text: "What's the most embarrassing song on your playlist?" },
  { id: "t15", type: "truth", text: "What's one thing you'd never confess sober?" },
  { id: "t16", type: "truth", text: "What's a hobby you'd secretly like to try with me?" },
  { id: "t17", type: "truth", text: "What did you think when you saw my last message?" },
  { id: "t18", type: "truth", text: "What's the pettiest reason you've ever been annoyed at me?" },
  { id: "t19", type: "truth", text: "What food do you pretend to like but don't?" },
  { id: "t20", type: "truth", text: "What's a song that always makes you think of me?" },
];

export const DARES: TodCard[] = [
  { id: "d01", type: "dare", text: "Do your best impression of me." },
  { id: "d02", type: "dare", text: "Show me the last photo you took." },
  { id: "d03", type: "dare", text: "Sing the chorus of the last song you listened to." },
  { id: "d04", type: "dare", text: "Read the first message we ever sent, out loud." },
  { id: "d05", type: "dare", text: "Do 10 jumping jacks on camera." },
  { id: "d06", type: "dare", text: "Show me what's in your fridge right now." },
  { id: "d07", type: "dare", text: "Send me a screenshot of your camera roll — any random one." },
  { id: "d08", type: "dare", text: "Do a runway walk across the room." },
  { id: "d09", type: "dare", text: "Speak in a British accent for the next 60 seconds." },
  { id: "d10", type: "dare", text: "Show me your most-used emoji." },
  { id: "d11", type: "dare", text: "Compliment me for a full 15 seconds without stopping." },
  { id: "d12", type: "dare", text: "Do your worst dance move." },
  { id: "d13", type: "dare", text: "Text a friend right now, only using emojis." },
  { id: "d14", type: "dare", text: "Show me your least-used app." },
  { id: "d15", type: "dare", text: "Do a dramatic reading of the last text you got." },
  { id: "d16", type: "dare", text: "Give the camera your best puppy eyes for 10 seconds." },
  { id: "d17", type: "dare", text: "Say 'I love you' in three different tones." },
  { id: "d18", type: "dare", text: "Try to touch your nose with your tongue." },
  { id: "d19", type: "dare", text: "Do the worst pickup line you know." },
  { id: "d20", type: "dare", text: "Draw a heart on your palm with your finger and hold it up." },
];

export function getTodCard(id: string): TodCard | null {
  return [...TRUTHS, ...DARES].find((c) => c.id === id) ?? null;
}

export function pickRandomTod(type: TodType, exclude: string | null): TodCard {
  const pool = type === "truth" ? TRUTHS : DARES;
  const filtered = exclude ? pool.filter((c) => c.id !== exclude) : pool;
  return filtered[Math.floor(Math.random() * filtered.length)]!;
}
