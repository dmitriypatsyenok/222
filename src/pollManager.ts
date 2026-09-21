import { PollData, PollStatus, PollVoter } from './types';

/**
 * Normalizes any raw poll object into a valid, strictly typed PollData,
 * recalculating eat/no/abs counts directly from the voters array to ensure mathematical integrity.
 */
export function normalizePoll(raw: any): PollData | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.id || typeof raw.id !== 'string') return null;
  if (!raw.date || typeof raw.date !== 'string') return null;
  if (raw.id === 'poll_init') return null;

  const voters: PollVoter[] = Array.isArray(raw.voters)
    ? raw.voters
        .filter((v: any) => v && typeof v.name === 'string' && (v.status === 'eat' || v.status === 'no' || v.status === 'abs'))
        .map((v: any) => ({ name: v.name.trim(), status: v.status as PollStatus }))
    : [];

  const eat = voters.filter(v => v.status === 'eat').length;
  const no = voters.filter(v => v.status === 'no').length;
  const abs = voters.filter(v => v.status === 'abs').length;

  return {
    id: raw.id,
    created: typeof raw.created === 'string' && raw.created ? raw.created : raw.date,
    date: raw.date,
    eat,
    no,
    abs,
    voters
  };
}

/**
 * Deduplicates and sorts polls by date in descending order (newest first).
 * If multiple polls share the same date, merges their voters without duplicates.
 */
export function cleanAndSortPolls(polls: (PollData | null | undefined)[]): PollData[] {
  const map = new Map<string, PollData>();

  for (const raw of polls) {
    const valid = normalizePoll(raw);
    if (!valid) continue;

    const existing = map.get(valid.date);
    if (!existing) {
      map.set(valid.date, valid);
    } else {
      // Merge voters from both so no student's vote is lost
      const voterMap = new Map<string, PollVoter>();
      existing.voters.forEach(v => voterMap.set(v.name.toLowerCase(), v));
      valid.voters.forEach(v => voterMap.set(v.name.toLowerCase(), v));

      const mergedVoters = Array.from(voterMap.values());
      const eat = mergedVoters.filter(v => v.status === 'eat').length;
      const no = mergedVoters.filter(v => v.status === 'no').length;
      const abs = mergedVoters.filter(v => v.status === 'abs').length;

      map.set(valid.date, {
        id: existing.id || valid.id,
        created: existing.created || valid.created,
        date: valid.date,
        eat,
        no,
        abs,
        voters: mergedVoters
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}

/**
 * Pure function to cast a vote on a poll.
 * Recomputes counts directly from voters array.
 */
export function castVote(
  poll: PollData,
  userName: string,
  status: PollStatus
): PollData {
  const cleanName = userName.trim();
  if (!cleanName) return poll;

  const currentVoters = Array.isArray(poll.voters) ? [...poll.voters] : [];
  const existingIdx = currentVoters.findIndex(v => v.name.toLowerCase() === cleanName.toLowerCase());

  if (existingIdx >= 0) {
    currentVoters[existingIdx] = { name: cleanName, status };
  } else {
    currentVoters.push({ name: cleanName, status });
  }

  const eat = currentVoters.filter(v => v.status === 'eat').length;
  const no = currentVoters.filter(v => v.status === 'no').length;
  const abs = currentVoters.filter(v => v.status === 'abs').length;

  return {
    ...poll,
    eat,
    no,
    abs,
    voters: currentVoters
  };
}

/**
 * Creates a new poll or reactivates an existing one for the target date.
 */
export function createOrActivatePoll(
  existingPolls: PollData[],
  targetDate: string,
  todayStr: string
): { updatedPolls: PollData[]; activePoll: PollData } {
  const cleaned = cleanAndSortPolls(existingPolls);
  const existing = cleaned.find(p => p.date === targetDate);

  let activePoll: PollData;
  if (existing) {
    activePoll = existing;
  } else {
    activePoll = {
      id: `poll_${targetDate.replace(/-/g, '')}_${Date.now()}`,
      created: todayStr,
      date: targetDate,
      eat: 0,
      no: 0,
      abs: 0,
      voters: []
    };
  }

  const updatedPolls = cleanAndSortPolls([activePoll, ...cleaned]);
  return { updatedPolls, activePoll };
}

/**
 * Deletes a poll by ID and returns the updated list and the new active poll.
 */
export function deletePoll(
  polls: PollData[],
  pollIdToDelete: string
): { updatedPolls: PollData[]; nextActivePoll: PollData | null } {
  const filtered = polls.filter(p => p.id !== pollIdToDelete);
  const updatedPolls = cleanAndSortPolls(filtered);
  const nextActivePoll = updatedPolls.length > 0 ? updatedPolls[0] : null;
  return { updatedPolls, nextActivePoll };
}

/**
 * Creates a blank/empty poll template.
 */
export function getEmptyPoll(): PollData {
  return {
    id: '',
    created: '',
    date: '',
    eat: 0,
    no: 0,
    abs: 0,
    voters: []
  };
}
