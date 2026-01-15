# Skills System PRD

## Overview

Skills extend the agent's capabilities with specialized knowledge and tools. They can be:

- **Instruction-based**: SKILL.md files that teach the agent how to perform tasks
- **Executable**: CLI tools the agent can invoke directly

For the full vision of skills in Moldable, see `moldable.prd.md` sections 4.1 (Skills) and 7.2 (Building a Skill).

---

## Current Implementation

### Repo-Based Skill Syncing

Skills are synced from GitHub repositories to `~/.moldable/shared/skills/`.

**Config location**: `~/.moldable/shared/config/skills.json`

```json
{
  "repositories": [
    {
      "name": "anthropic-skills",
      "url": "anthropics/skills",
      "branch": "main",
      "skillsPath": "skills",
      "enabled": true,
      "mode": "include",
      "skills": ["pdf", "docx", "xlsx", "webapp-testing", "frontend-design"],
      "lastSync": "2026-01-14T..."
    }
  ]
}
```

**Available tools** (in `packages/ai/src/tools/skills.ts`):

| Tool                   | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `initSkillsConfig`     | Initialize with default Anthropic skills   |
| `listSkillRepos`       | List registered repositories               |
| `listAvailableSkills`  | Show skills available in a repo            |
| `addSkillRepo`         | Add a new skill repository                 |
| `updateSkillSelection` | Change which skills are synced from a repo |
| `syncSkills`           | Download skills to local filesystem        |

**Synced skills location**: `~/.moldable/shared/skills/{repo-name}/{skill-name}/`

---

## Not Yet Implemented

### Per-Workspace Skill Enablement

The `moldable.prd.md` describes per-workspace skill enabling:

```
~/.moldable/workspaces/{id}/config/skills.json
```

```json
{
  "enabledSkills": ["translate-text", "audio-transcribe"],
  "disabledSkills": ["company-internal-tool"]
}
```

**Use case**: A "company-internal-tool" skill should only be enabled in the Work workspace, not Personal.

### Open Question

**Do we need per-workspace enablement?**

Options:

1. **Keep it simple** — All synced skills are available everywhere. Remove per-workspace config from docs.
2. **Implement enablement** — Add `workspaces/{id}/config/skills.json` for granular control.

Current recommendation: Start simple (option 1). Add per-workspace enablement only if users request it.

---

## TODO

- [ ] Decide on per-workspace enablement (keep or drop from design)
- [ ] Update AGENTS.md to match decision
- [ ] Update moldable.prd.md directory structure if dropping per-workspace config
- [ ] Implement skill discovery in agent context (make synced skills visible to agent)

---

## References

- `moldable.prd.md` — Full skills vision (sections 4.1, 7.2)
- `packages/ai/src/tools/skills.ts` — Current implementation
- `scripts/sync-agent-skills.js` — CLI script for syncing
