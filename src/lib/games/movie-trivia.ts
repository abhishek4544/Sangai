/**
 * Movie Trivia question bank. Curated, not TMDB-scraped — a static deck is
 * snappier, predictable, and doesn't need a round-trip per question.
 *
 * Wire model uses only the `questionIdx` (int), so the deck can grow without
 * an envelope-version bump. If both peers happen to be on different bank
 * versions, worst case one sees a stale question — trivially self-heals on
 * "Next" (index advances, both look up the current deck).
 */
export type TriviaCategory =
  | "classics"
  | "oscars"
  | "quotes"
  | "actors"
  | "romance";

export interface TriviaQuestion {
  id: string;
  category: TriviaCategory;
  question: string;
  options: readonly [string, string, string, string];
  /** 0-based index into `options`. */
  correctIdx: 0 | 1 | 2 | 3;
}

/** ~40 questions, mixed categories. Enough for a couple of rounds before
 *  repeats matter. Ordered as-picked; the component runs in fixed order so
 *  both peers see the same question at index i without a shared shuffle. */
export const TRIVIA_QUESTIONS: TriviaQuestion[] = [
  { id: "t01", category: "oscars", question: "Which movie won Best Picture at the 2020 Oscars?", options: ["1917", "Parasite", "Joker", "Once Upon a Time in Hollywood"], correctIdx: 1 },
  { id: "t02", category: "classics", question: "Who directed 'The Godfather'?", options: ["Martin Scorsese", "Francis Ford Coppola", "Stanley Kubrick", "Alfred Hitchcock"], correctIdx: 1 },
  { id: "t03", category: "quotes", question: "'Here's looking at you, kid' is from which movie?", options: ["Casablanca", "Gone with the Wind", "The Maltese Falcon", "Citizen Kane"], correctIdx: 0 },
  { id: "t04", category: "actors", question: "Who played Neo in The Matrix?", options: ["Brad Pitt", "Keanu Reeves", "Tom Cruise", "Nicolas Cage"], correctIdx: 1 },
  { id: "t05", category: "romance", question: "In 'Titanic', what does Rose promise Jack she'll never do?", options: ["Marry rich", "Let go", "Sing again", "Return to America"], correctIdx: 1 },
  { id: "t06", category: "classics", question: "What year was 'Jaws' released?", options: ["1973", "1975", "1977", "1979"], correctIdx: 1 },
  { id: "t07", category: "oscars", question: "Which film won Best Picture at the 2023 Oscars?", options: ["The Fabelmans", "Everything Everywhere All at Once", "Top Gun: Maverick", "Elvis"], correctIdx: 1 },
  { id: "t08", category: "actors", question: "Which actor has won the most Best Actor Oscars?", options: ["Jack Nicholson", "Daniel Day-Lewis", "Marlon Brando", "Tom Hanks"], correctIdx: 1 },
  { id: "t09", category: "quotes", question: "'May the Force be with you' comes from…", options: ["Star Trek", "Star Wars", "Guardians of the Galaxy", "Dune"], correctIdx: 1 },
  { id: "t10", category: "classics", question: "Who directed 'Pulp Fiction'?", options: ["Steven Spielberg", "Quentin Tarantino", "Ridley Scott", "David Fincher"], correctIdx: 1 },
  { id: "t11", category: "romance", question: "In 'The Notebook', how do Noah and Allie first meet?", options: ["At a diner", "On a Ferris wheel", "At a dance", "At the beach"], correctIdx: 1 },
  { id: "t12", category: "actors", question: "Who played the Joker in 'The Dark Knight' (2008)?", options: ["Joaquin Phoenix", "Heath Ledger", "Jared Leto", "Jack Nicholson"], correctIdx: 1 },
  { id: "t13", category: "oscars", question: "Which film won Best Picture in 2019?", options: ["Green Book", "Roma", "Black Panther", "Bohemian Rhapsody"], correctIdx: 0 },
  { id: "t14", category: "quotes", question: "'I'm going to make him an offer he can't refuse' — which film?", options: ["Scarface", "Goodfellas", "The Godfather", "Casino"], correctIdx: 2 },
  { id: "t15", category: "classics", question: "What's the highest-grossing film of all time (as of 2024)?", options: ["Titanic", "Avengers: Endgame", "Avatar", "Star Wars: The Force Awakens"], correctIdx: 2 },
  { id: "t16", category: "romance", question: "'La La Land' pairs which two leads?", options: ["Ryan Gosling & Emma Stone", "Ryan Reynolds & Blake Lively", "Chris Evans & Ana de Armas", "Timothée Chalamet & Zendaya"], correctIdx: 0 },
  { id: "t17", category: "actors", question: "Who voiced Woody in 'Toy Story'?", options: ["Tim Allen", "Tom Hanks", "Billy Crystal", "John Goodman"], correctIdx: 1 },
  { id: "t18", category: "quotes", question: "'You had me at hello' is from…", options: ["Notting Hill", "Jerry Maguire", "When Harry Met Sally", "Sleepless in Seattle"], correctIdx: 1 },
  { id: "t19", category: "classics", question: "Who directed 'Inception'?", options: ["Denis Villeneuve", "Christopher Nolan", "David Fincher", "Ridley Scott"], correctIdx: 1 },
  { id: "t20", category: "oscars", question: "Which movie won Best Picture in 2014?", options: ["Boyhood", "Birdman", "12 Years a Slave", "The Grand Budapest Hotel"], correctIdx: 2 },
  { id: "t21", category: "romance", question: "In '500 Days of Summer', how many days of Summer are there?", options: ["365", "500", "180", "1000"], correctIdx: 1 },
  { id: "t22", category: "actors", question: "Who plays Hermione in the Harry Potter films?", options: ["Emma Roberts", "Emma Watson", "Emma Stone", "Emma Thompson"], correctIdx: 1 },
  { id: "t23", category: "quotes", question: "'To infinity, and beyond!' — who says it?", options: ["Buzz Lightyear", "Woody", "Mr. Incredible", "Lightning McQueen"], correctIdx: 0 },
  { id: "t24", category: "classics", question: "Which movie features the line 'Life is like a box of chocolates'?", options: ["Big Fish", "The Green Mile", "Forrest Gump", "Cast Away"], correctIdx: 2 },
  { id: "t25", category: "oscars", question: "Which film swept the 2024 Oscars with 7 wins?", options: ["Poor Things", "Oppenheimer", "Killers of the Flower Moon", "Anatomy of a Fall"], correctIdx: 1 },
  { id: "t26", category: "romance", question: "'Pride and Prejudice' (2005) — who plays Mr. Darcy?", options: ["Colin Firth", "Matthew Macfadyen", "Hugh Grant", "Ralph Fiennes"], correctIdx: 1 },
  { id: "t27", category: "actors", question: "Who played Katniss in 'The Hunger Games'?", options: ["Shailene Woodley", "Jennifer Lawrence", "Kristen Stewart", "Emma Stone"], correctIdx: 1 },
  { id: "t28", category: "quotes", question: "'I'll be back' is famously said by…", options: ["The Terminator", "Rocky", "Rambo", "John McClane"], correctIdx: 0 },
  { id: "t29", category: "classics", question: "Which film is set entirely on Air Force One?", options: ["Independence Day", "Air Force One", "Con Air", "Executive Decision"], correctIdx: 1 },
  { id: "t30", category: "oscars", question: "Which film won Best Picture in 2017?", options: ["La La Land", "Moonlight", "Manchester by the Sea", "Hidden Figures"], correctIdx: 1 },
  { id: "t31", category: "romance", question: "'Before Sunrise' takes place in which city?", options: ["Paris", "Vienna", "Prague", "Rome"], correctIdx: 1 },
  { id: "t32", category: "actors", question: "Who played Rachel in 'Friends'?", options: ["Jennifer Aniston", "Courteney Cox", "Lisa Kudrow", "Sarah Michelle Gellar"], correctIdx: 0 },
  { id: "t33", category: "quotes", question: "'Why so serious?' is spoken by which character?", options: ["Bane", "The Riddler", "The Joker", "Scarecrow"], correctIdx: 2 },
  { id: "t34", category: "classics", question: "Who directed 'Schindler's List'?", options: ["Martin Scorsese", "Steven Spielberg", "Oliver Stone", "Ron Howard"], correctIdx: 1 },
  { id: "t35", category: "oscars", question: "Which was the first animated film nominated for Best Picture?", options: ["Toy Story", "Beauty and the Beast", "Up", "The Lion King"], correctIdx: 1 },
  { id: "t36", category: "romance", question: "'Amélie' is set in which city?", options: ["Paris", "Marseille", "Lyon", "Bordeaux"], correctIdx: 0 },
  { id: "t37", category: "actors", question: "Who played Wolverine across the X-Men films?", options: ["Hugh Jackman", "Chris Hemsworth", "Ryan Reynolds", "Michael Fassbender"], correctIdx: 0 },
  { id: "t38", category: "quotes", question: "'Just keep swimming' is from…", options: ["Shark Tale", "Finding Nemo", "The Little Mermaid", "Moana"], correctIdx: 1 },
  { id: "t39", category: "classics", question: "Which film is famous for its shower scene?", options: ["Vertigo", "Psycho", "The Birds", "Rear Window"], correctIdx: 1 },
  { id: "t40", category: "oscars", question: "Which film won the 2022 Best Picture Oscar?", options: ["Dune", "The Power of the Dog", "CODA", "Belfast"], correctIdx: 2 },
];

/** How many questions in a single game. */
export const ROUND_LENGTH = 10;

export function getTriviaQuestion(idx: number): TriviaQuestion | null {
  return TRIVIA_QUESTIONS[idx] ?? null;
}
