# GBK Core adaptation: fork baseline and implementation plan

Status: repository preparation and source audit only. GBK support is not implemented
or accepted yet. This document describes this fork's work, not an upstream feature.

The detailed receiving-AI implementation, compatibility, build, and release work
package is now in [gbk-handoff/00-README.md](gbk-handoff/00-README.md). Use that
package for phase-by-phase execution; this file retains the initial audit baseline.

## Baseline

- Fork: https://github.com/ethan-blue/oh-my-pi
- Upstream: https://github.com/can1357/oh-my-pi
- Workspace: `D:\Projects\GitProjects\oh-my-pi`
- Development branch: `feat/gbk-text-io`
- Starting release: `v18.8.4`
- Starting commit: `40e9368ef0458fd9073329cdff4174895f91bc6b`
- Upstream main observed on 2026-10-08: `c50daa5296d0ae7921560b8bca6091cf01d3481b`
- `origin` points to the fork; `upstream` points to the original repository.
- The clone retains history and fetches historical blobs on demand (`blob:none`).
- Bun is not available on the inspected command PATH. Dependencies, native builds,
  application tests, and performance measurements have not been run.
- Root package manager requirement: `bun@>=1.4`; the Rust toolchain is pinned in
  `rust-toolchain.toml` to `nightly-2026-10-06`. Check actual tool availability
  before setup. Do not run global link/install steps as a substitute for a local build.

## Decision

Modify OMP Core to edit the existing Windows GBK project directly. Do not introduce
a virtual disk, WSL conversion service, or synchronized UTF-8 project copy.

Keep the native edit engine and Hashline algorithm. Extend the existing file
boundaries with a consistent encoding policy and metadata. Do not rewrite unrelated
modules for speculative performance gains. A small patch surface is an objective;
complete supported-path coverage takes precedence over an arbitrary file count.

## Verified source entry points at the baseline

| Surface | Current entry points | Required follow-up |
| --- | --- | --- |
| Text read and display | `packages/coding-agent/src/tools/read.ts` | Buffered and streaming UTF-8 decoding, binary classification, truncation, and snapshot consistency |
| Native edit file access | `crates/pi-edit/src/files.rs` | `FileCache::read_resolved` currently uses `String::from_utf8`; preserve encoding metadata through persist |
| Native snapshots | `crates/pi-edit/src/store.rs` | `record_file` currently uses `std::fs::read_to_string`; must agree with read and edit decoding |
| Edit binding and host writes | `crates/pi-natives/src/edit.rs`, `packages/coding-agent/src/edit/index.ts` | Policy across N-API, write requests, move destinations, and post-write snapshots |
| Ordinary writes and formatting | `packages/coding-agent/src/tools/write.ts`, `packages/coding-agent/src/lsp/writethrough.ts` | Existing-file encoding, new-file defaults, formatter output, and bytes persisted |
| Permission fallback | `packages/coding-agent/src/tools/file-write-fallback.ts` | Preserve its permission contract; it is not a general encoding hook |
| LSP edits and rollback | `packages/coding-agent/src/lsp/edits.ts` | Text edits, creation, rename, and byte-faithful rollback |
| AST search and rewriting | `crates/pi-natives/src/ast.rs`, `packages/coding-agent/src/tools/ast-edit.ts` | Native filesystem reads/writes and snapshots; byte offsets must refer to the decoded parser input |
| Content search | `crates/pi-natives/src/grep.rs`, `packages/coding-agent/src/tools/grep.ts` | Chinese matching, returned text, line positions, and snapshot agreement |
| Repair paths | `packages/coding-agent/src/edit/auto-repair.ts` | Direct file reads must use the same interpretation |

This is the initial entry-point inventory, not proof of exhaustive coverage.
Further audit must include ACP, formatters, internal URLs, child sessions, and
preview/apply/rollback paths. The upstream fallback documentation contains older
TypeScript edit-path references; use executable code at this commit as authority.

## Encoding and integrity contract

1. Opt in at project scope; allow per-path overrides. Never change OMP session,
   credentials, JSON configuration, or arbitrary binary storage to GBK globally.
2. Prefer explicit encoding policy. ASCII alone cannot identify the intended
   encoding. Valid UTF-8 bytes do not universally prove a file was intended as UTF-8.
   Define ambiguous-file behavior before adding detection heuristics.
3. Preserve existing encoding and applicable BOM, CRLF/LF, and final-newline state.
   Mixed line endings must be preserved or explicitly rejected when the engine
   cannot preserve them; do not silently normalize an entire file.
4. Reject invalid input and unrepresentable output before changing the destination.
   Do not use replacement characters, question marks, HTML numeric entities, or
   automatic GBK-to-GB18030 promotion. GB18030 is a separate explicit capability.
5. For untouched content, require byte-faithful round trips. Keep original bytes
   for no-op operations and rollback rather than reconstructing them from text.
6. Hashline operates on consistently normalized decoded text. Encoding metadata
   and original-byte/version checks protect persistence separately.
7. Retain current stale-edit protections, path handling, permission fallbacks,
   cancellation, and symlink semantics. A pre-write hash check alone does not solve
   the race between checking and writing. Specify the supported concurrency model.
8. Define encoding for new files and moves explicitly. Moves must not infer the
   source encoding from an absent destination or delete the source after a failed write.
9. Preflight all files in multi-file edits and retain recoverable original bytes.
   Do not claim multi-file atomicity from single-file atomic replacements.
10. External Python/PowerShell, ACP clients, and external formatters own their file
    operations. Adapt, constrain, or report unsupported behavior for these paths;
    Core support does not automatically make arbitrary scripts encoding-aware.

## Implementation order and acceptance

1. Establish a runnable local baseline and targeted existing edit/read/write tests.
   Record failures before changes. Keep toolchain setup separate from behavior changes.
2. Choose the shared codec/policy boundary from the native and TS call graph.
   `encoding_rs` exists transitively in `Cargo.lock`, but is not currently a direct
   `pi-edit` dependency; verify strict GBK behavior before adopting any codec.
   Do not add two independently behaving native and JS codec implementations.
3. Wire read -> snapshot -> Hashline edit -> host persistence as the first end-to-end
   slice. Accept only after exact output bytes and stale-edit rejection are tested.
4. Cover write/create, patch, move/delete, AST, grep, LSP, rollback, and child
   session policy propagation with externally observable regression tests.
5. Define explicit support for ACP and subprocess formatters. Mark unsupported
   paths as unsupported rather than declaring all built-in paths complete.
6. Exercise representative E630 source, headers, resources, and Chinese literals
   with the original Windows compiler/toolchain. Synthetic fixtures are necessary
   but do not prove E630 compatibility; no E630 files were inspected during setup.

Required fixture cases: GBK Chinese comments and strings; UTF-8 with/without BOM;
ASCII files under a GBK policy; mixed-encoding directories; CRLF/LF and missing
final newline; invalid/truncated byte sequences; non-GBK output; non-ASCII paths;
concurrent changes; move destinations; cancellation; failed writes; rollback;
binary files; and multibyte boundaries in streaming reads.

## Performance policy

- Preserve the default UTF-8/native path where possible. No subprocess conversion,
  whole-project scans, or speculative codec detection on every file access.
- Reuse bytes already read for display, decoding, and snapshot creation. Avoid
  duplicate full-file reads within one operation while retaining fresh apply-time
  validation and correctness under concurrent edits.
- Keep codec state scoped to a project/session or operation. Do not cache solely
  by filename across projects; do not treat mtime plus length as proof of identity.
- Measure end-to-end read, grep, Hashline edit, and multi-file edit using identical
  fixtures, toolchain, cache conditions, and hardware against the release baseline.
  Separate UTF-8 overhead from GBK conversion cost; record p50/p95 and peak memory.
- Use small files, roughly 1 MiB and 4 MiB files, a file above the snapshot cap, and
  directory searches. Preserve bounded behavior for large files.
- A proposed UTF-8 latency regression above 5% on repeatable non-noise-dominated
  workloads requires investigation before acceptance. This is a review trigger,
  not a measured result or a universal guarantee. No claim of globally optimal
  performance is made.

## Updating the fork

1. Keep `main` free of downstream feature changes. Fetch upstream tags and branches
   explicitly; avoid updating a production installation directly from upstream main.
2. Record the last accepted upstream release and downstream commit. Keep the
   currently usable binary and configuration available for rollback.
3. With a clean checkout, create a disposable `integration/...` branch from the
   GBK development branch and merge the chosen upstream release there. Do not
   force-push or rewrite a shared branch as a routine upgrade step.
4. Review upstream changes to the above boundaries, new tools, native interfaces,
   and dependencies. A conflict-free merge does not prove encoding coverage.
5. Run the repository-prescribed checks (`bun check`, scoped package tests, and
   `bun run test:rs` when Rust changes), GBK byte-level/Hashline regressions, Windows
   runtime checks, and comparative benchmarks. Exact targeted commands will be
   recorded with the implemented tests; there is no working GBK gate yet.
6. Promote only a verified integration result; otherwise leave the accepted branch
   and installed version in place. Document unresolved failures rather than silently
   falling back to UTF-8 writes.

Upstream contribution can reduce maintenance later but is not assumed. Follow
`CONTRIBUTING.md` before submitting upstream; creating this fork does not post an
issue, discussion, or pull request. No commit is created without the user's request,
as required by the repository's `AGENTS.md`.
