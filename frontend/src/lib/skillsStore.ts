// Loads the admin-configurable skill registry from the server, cached in
// localStorage so the Job Report can decide which skills to rate offline.

import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";

export type Skill = {
  id: number;
  name: string;
  category: string;
  binary: boolean;
  core: boolean;
  relevant_job_types: string[];
  definition: string | null;
  sort_order: number;
  active: boolean;
};

const CACHE_KEY = "crew_skills_v1";

export function cachedSkills(): Skill[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr as Skill[];
    }
  } catch {
    /* fall through */
  }
  return [];
}

export async function fetchSkills(): Promise<Skill[]> {
  const rows = await apiFetch<Skill[]>("/api/skills");
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch {
    /* quota - noop */
  }
  return rows;
}

export function useSkills(): Skill[] {
  const [skills, setSkills] = useState<Skill[]>(cachedSkills);
  useEffect(() => {
    fetchSkills().then(setSkills).catch(() => {/* offline - keep cache */});
  }, []);
  return skills;
}

// Skills to rate on a report for a job with the given type tags: every core
// skill, plus any skill whose relevant_job_types intersects the job's tags.
export function skillsForJobTypes(skills: Skill[], jobTags: string[]): Skill[] {
  const tags = new Set(jobTags);
  return skills.filter(
    (s) => s.active && (s.core || s.relevant_job_types.some((t) => tags.has(t))),
  );
}
