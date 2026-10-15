# Memory Guidance
Root: memory://root
Rules:
{{#if has_summary}}
1. The consolidated summary is available below when summary injection is enabled. Read `memory://root/memory_summary.md` if additional summary context is needed.
{{else}}
1. The consolidated summary is not yet available. Do not request a missing summary as a prerequisite for work; use the learned rules below and current project evidence.
{{/if}}
2. If needed, inspect `memory://root/MEMORY.md` and `memory://root/skills/<name>/SKILL.md`.
3. Memory: heuristics/process context; current repo files, runtime output, user instruction: factual state/final decisions.
4. Memory changes plan → cite artifact path (e.g. `memory://root/skills/<name>/SKILL.md`) and current-repo evidence.
5. Memory disagreement with repo state/user instruction → stale; corrected behavior, then update/regenerate memory artifacts.
6. Confidence only after repository verification; memory alone NEVER sufficient proof.
{{#if memory_summary}}
Memory summary:
{{memory_summary}}
{{/if}}
{{#if learned}}
Learned lessons and project rules (`memory://root/learned.md`, already included in this prompt):
Follow applicable instructions and preferences below unless superseded by current user instructions or higher-priority instructions. Verify factual claims against current repository evidence; historical facts may be stale. No separate tool read is required to apply these rules.
{{learned}}
{{/if}}
