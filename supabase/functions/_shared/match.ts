/**
 * Decides whether a Google Text Search result is actually what the user typed.
 *
 * This exists because Text Search has no concept of "no match": a garbage query
 * still returns 20 confident-looking restaurants. Taking the top candidate on
 * faith would silently write the wrong venue into a shared list that has no
 * delete UI, so every result is scored against the query first.
 *
 * Runtime-agnostic: no Deno or Node globals.
 */

export interface Candidate {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  primaryTypeDisplayName?: { text?: string };
  regularOpeningHours?: unknown;
}

export type MatchStatus = "resolved" | "ambiguous" | "not_found";

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
}

/** Below this, the top candidate is treated as junk rather than a weak match. */
export const MIN_SCORE = 0.5;

/** Candidates within this of the leader are considered tied. */
export const TIE_MARGIN = 0.1;

/** Lowercase, strip accents, split on anything non-alphanumeric. */
export function tokenize(text: string): Set<string> {
  const normalized = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let hits = 0;
  for (const token of a) if (b.has(token)) hits++;
  return hits;
}

/**
 * Similarity in [0, 1], the max of two directional coverages.
 *
 * Both directions are needed because either alone misfires:
 *   - "Franklin Barbecue Austin TX" vs "Franklin Barbecue" — the city tokens the
 *     user added for disambiguation aren't in the name, so query-coverage is
 *     only 0.5 despite being an exact hit. Name-coverage is 1.0.
 *   - "Spicy Boys" vs "Spicy Boys Fried Chicken - South Austin" — the user typed
 *     a prefix, so name-coverage is 0.33. Query-coverage is 1.0.
 * Taking the max lets either signal carry the match; junk scores 0 both ways.
 */
export function scoreMatch(query: string, name: string): number {
  const q = tokenize(query);
  const n = tokenize(name);
  if (q.size === 0 || n.size === 0) return 0;
  const shared = overlap(q, n);
  return Math.max(shared / n.size, shared / q.size);
}

export interface Classification {
  status: MatchStatus;
  /** Set when status is "resolved". */
  match?: Candidate;
  /** Set when status is "ambiguous" — the tied candidates, for the retry UI. */
  options?: ScoredCandidate[];
}

/**
 * Breaks a name-score tie using the address.
 *
 * Chains give every branch the *identical* displayName ("Veracruz All Natural"),
 * so name scoring alone can never separate them and the user would be stuck
 * retyping forever. The brief already tells people to append a city, so the
 * location words they add are the intended signal.
 *
 * Only query tokens absent from the name are counted — those are the ones doing
 * disambiguating work. Tokens shared by every candidate (e.g. "austin") cancel
 * out, leaving a tie, which is the correct answer for a genuinely vague query.
 */
function addressTiebreak(query: string, tied: ScoredCandidate[]): Candidate | null {
  const queryTokens = tokenize(query);

  const scores = tied.map(({ candidate }) => {
    const nameTokens = tokenize(candidate.displayName?.text ?? "");
    const addressTokens = tokenize(candidate.formattedAddress ?? "");
    let hits = 0;
    for (const token of queryTokens) {
      if (!nameTokens.has(token) && addressTokens.has(token)) hits++;
    }
    return { candidate, hits };
  });

  scores.sort((a, b) => b.hits - a.hits);
  // A strict winner only. Equal hits means the query didn't actually pick one.
  if (scores[0].hits > 0 && scores[0].hits > scores[1].hits) return scores[0].candidate;
  return null;
}

/**
 * Classify a query's candidates as resolved / ambiguous / not_found.
 *
 * Ambiguous results are deliberately NOT written. The list is shared and has no
 * delete path, so a wrong row is worse than a missing one — the user retries
 * with a more specific string instead.
 */
export function classifyCandidates(
  query: string,
  candidates: Candidate[],
): Classification {
  if (!candidates || candidates.length === 0) return { status: "not_found" };

  const scored: ScoredCandidate[] = candidates
    .map((candidate) => ({
      candidate,
      score: scoreMatch(query, candidate.displayName?.text ?? ""),
    }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (top.score < MIN_SCORE) return { status: "not_found" };

  const tied = scored.filter((s) => s.score >= top.score - TIE_MARGIN);
  if (tied.length > 1) {
    const winner = addressTiebreak(query, tied);
    if (winner) return { status: "resolved", match: winner };
    return { status: "ambiguous", options: tied.slice(0, 5) };
  }

  return { status: "resolved", match: top.candidate };
}
