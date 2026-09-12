/**
 * How Well Do You Know Me — turn-based multiple-choice couples game.
 *
 * Each round has one subject (alternating turns, deterministic from sorted
 * identities). The subject picks the option that's true for them; the partner
 * guesses which one. Score = correct guesses.
 *
 * Deck ordering comes from the weekly shuffle (`./shuffle.ts`), so both peers
 * see the same question at the same `roundIdx` and the deck rotates fresh
 * every Monday UTC without any per-round coordination.
 */

import { pickFromDeck } from "./shuffle";

export interface HWPrompt {
  id: string;
  question: string;
  /** Exactly 4 options. Keep each ≤ 24 chars so the option-button typography
   *  stays legible on narrow phones. */
  options: [string, string, string, string];
  flavor?: string;
}

const HW_DECK_ID = "how-well";

export const HW_DECK: HWPrompt[] = [
  {
    id: "hw-1",
    question: "Ideal Friday night?",
    options: ["Cozy at home", "Dinner out", "Live music", "Party 'til 2am"],
    flavor: "🌙",
  },
  {
    id: "hw-2",
    question: "Comfort food?",
    options: ["Pizza", "Ice cream", "Ramen", "Chocolate"],
    flavor: "🍕",
  },
  {
    id: "hw-3",
    question: "Coffee order?",
    options: ["Black", "Milk & sugar", "Fancy latte", "Never coffee"],
    flavor: "☕",
  },
  {
    id: "hw-4",
    question: "Dream vacation?",
    options: ["Beach", "Mountains", "Big city", "Countryside"],
    flavor: "🏝️",
  },
  {
    id: "hw-5",
    question: "How do you fall asleep?",
    options: ["Instantly", "Reading", "Podcast on", "Toss & turn"],
    flavor: "😴",
  },
  {
    id: "hw-6",
    question: "First thing you do in the morning?",
    options: ["Snooze", "Check phone", "Coffee", "Shower"],
    flavor: "🌅",
  },
  {
    id: "hw-7",
    question: "Guilty-pleasure genre?",
    options: ["Rom-com", "Horror", "Reality TV", "Trashy pop"],
    flavor: "🎬",
  },
  {
    id: "hw-8",
    question: "Ideal Sunday morning?",
    options: ["Brunch out", "Sleep in", "Long walk", "Bed all day"],
    flavor: "🥐",
  },
  {
    id: "hw-9",
    question: "Biggest pet peeve?",
    options: ["Loud chewers", "Late people", "Slow walkers", "Bad tippers"],
    flavor: "😤",
  },
  {
    id: "hw-10",
    question: "Favorite way to be shown love?",
    options: ["Words", "Gifts", "Touch", "Quality time"],
    flavor: "💖",
  },
  {
    id: "hw-11",
    question: "Ideal pet?",
    options: ["Dog", "Cat", "Neither", "Something weird"],
    flavor: "🐕",
  },
  {
    id: "hw-12",
    question: "Perfect birthday?",
    options: ["Small dinner", "Big party", "Surprise trip", "Skip it"],
    flavor: "🎂",
  },
  {
    id: "hw-13",
    question: "Go-to karaoke song?",
    options: ["Power ballad", "Rap anthem", "Old classic", "Never karaoke"],
    flavor: "🎤",
  },
  {
    id: "hw-14",
    question: "Ideal weather?",
    options: ["Sunny", "Rainy", "Snowy", "Foggy"],
    flavor: "☁️",
  },
  {
    id: "hw-15",
    question: "Dessert pick?",
    options: ["Cake", "Ice cream", "Cookies", "Fruit"],
    flavor: "🍰",
  },
  {
    id: "hw-16",
    question: "Superpower you'd choose?",
    options: ["Flying", "Invisibility", "Reading minds", "Teleporting"],
    flavor: "🦸",
  },
  {
    id: "hw-17",
    question: "Argument style?",
    options: ["Talk it out", "Need space", "Overthink it", "Avoid conflict"],
    flavor: "💬",
  },
  {
    id: "hw-18",
    question: "Perfect movie snack?",
    options: ["Popcorn", "Nachos", "Candy", "Nothing"],
    flavor: "🍿",
  },
  {
    id: "hw-19",
    question: "Favorite season?",
    options: ["Spring", "Summer", "Autumn", "Winter"],
    flavor: "🍂",
  },
  {
    id: "hw-20",
    question: "Music while driving?",
    options: ["Pop", "Rock", "Hip-hop", "Podcast"],
    flavor: "🚗",
  },
  {
    id: "hw-21",
    question: "Type of humor?",
    options: ["Dry & witty", "Silly & random", "Dark", "Puns"],
    flavor: "😂",
  },
  {
    id: "hw-22",
    question: "Ideal date night?",
    options: ["Fancy dinner", "Movie in", "Adventure out", "Cook together"],
    flavor: "💫",
  },
  {
    id: "hw-23",
    question: "Bedtime routine?",
    options: ["Skincare works", "Straight to bed", "TV first", "Late scroll"],
    flavor: "🛁",
  },
  {
    id: "hw-24",
    question: "Favorite cuisine?",
    options: ["Italian", "Asian", "Mexican", "Home cooking"],
    flavor: "🍜",
  },
  {
    id: "hw-25",
    question: "Weekend energy?",
    options: ["Adventurous", "Chill", "Productive", "Social"],
    flavor: "🎯",
  },
  {
    id: "hw-26",
    question: "Type of trip?",
    options: ["Planned to the min", "Loose plan", "Wing it", "Nap-first"],
    flavor: "🗺️",
  },
  {
    id: "hw-27",
    question: "Comfort show?",
    options: ["The Office", "Friends", "A cartoon", "Something weird"],
    flavor: "📺",
  },
  {
    id: "hw-28",
    question: "Money style?",
    options: ["Saver", "Spender", "Balanced", "It's complicated"],
    flavor: "💰",
  },
  {
    id: "hw-29",
    question: "Perfect gift?",
    options: ["Handmade", "Experience", "Expensive thing", "Practical"],
    flavor: "🎁",
  },
  {
    id: "hw-30",
    question: "How you show stress?",
    options: ["Quiet", "Talky", "Snappy", "Snack it away"],
    flavor: "😬",
  },
  {
    id: "hw-31",
    question: "Ideal roomie vibe?",
    options: ["Quiet minimalist", "Cozy chaos", "Plant kingdom", "Gadget nerd"],
    flavor: "🏠",
  },
  {
    id: "hw-32",
    question: "Favorite drink?",
    options: ["Water", "Cocktails", "Beer/wine", "Tea"],
    flavor: "🍸",
  },
  {
    id: "hw-33",
    question: "Group setting move?",
    options: ["Life of party", "Deep 1-on-1", "Observer", "Bail early"],
    flavor: "🎉",
  },
  {
    id: "hw-34",
    question: "Sport of choice?",
    options: ["Gym", "Yoga/pilates", "Team sport", "Absolutely none"],
    flavor: "🏋️",
  },
  {
    id: "hw-35",
    question: "Perfect texting pace?",
    options: ["All day", "Once/twice", "Bursts", "Call me instead"],
    flavor: "📱",
  },
  {
    id: "hw-36",
    question: "Dream job vibe?",
    options: ["Creative", "Analytical", "People-first", "Hands-on"],
    flavor: "💼",
  },
  {
    id: "hw-37",
    question: "Favorite morning weather?",
    options: ["Sunny", "Cool & crisp", "Cozy rain", "Fog"],
    flavor: "🌤️",
  },
  {
    id: "hw-38",
    question: "Movie theater seat?",
    options: ["Front row", "Dead center", "Back row", "Aisle"],
    flavor: "🎟️",
  },
  {
    id: "hw-39",
    question: "Time-travel pick?",
    options: ["Distant past", "Recent past", "Near future", "Far future"],
    flavor: "🕰️",
  },
  {
    id: "hw-40",
    question: "Perfect afternoon?",
    options: ["Read a book", "Take a nap", "Cook something", "Long walk"],
    flavor: "🌞",
  },
];

export function getHWPrompt(idx: number, weekSeed: number): HWPrompt {
  return pickFromDeck(HW_DECK, idx, weekSeed, HW_DECK_ID);
}

export const HW_DECK_LENGTH = HW_DECK.length;
