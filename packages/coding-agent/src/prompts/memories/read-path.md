# Memory Guidance
{{#if has_summary}}
{{#if memory_summary}}
Historical summary (preloaded; full text: `memory://root/memory_summary.md`):
{{memory_summary}}
{{else}}
For tasks depending on prior project decisions or work, read `memory://root/memory_summary.md`; otherwise proceed without historical recall.
{{/if}}
{{else}}
Historical summary is not yet available; do not read it as a prerequisite.
{{/if}}
For more detail, read relevant `memory://root/MEMORY.md` or `memory://root/skills/<name>/SKILL.md`. Verify historical claims against current evidence; cite memory paths when they affect decisions. Current user instructions and repository evidence override stale memory.
{{#if learned}}
Learned lessons and rules (already loaded from `memory://root/learned.md`; no reread needed). Apply relevant rules unless superseded by current user or higher-priority instructions:
{{learned}}
{{/if}}
