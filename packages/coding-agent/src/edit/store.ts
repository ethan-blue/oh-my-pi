/**
 * Session-scoped native edit state: full-file snapshots that mint hashline
 * tags (recorded by `read`/`search`/`write`), `CUT`/`PUT` clipboard
 * registers, and the byte-identical no-op loop guard. One store per
 * {@link ToolSession}; every {@link EditSession} the edit tool opens shares it.
 */
import { EditStore } from "@oh-my-pi/pi-natives";
import { discoverEncodingPolicy } from "../encoding/index";

/** Owner of the lazily created per-session store. */
export interface EditStoreOwner {
	editStore?: EditStore;
	/** Working directory the encoding policy is discovered from. */
	cwd?: string;
}

/**
 * The session's store, created on first use. The store also carries the
 * project's encoding policy so `recordSnapshotFile` decodes managed files
 * exactly like the edit engine does; a policy change (detected by config
 * mtime AND content) clears snapshots so stale-policy text never mixes with
 * fresh reads.
 */
export function getEditStore(session: EditStoreOwner): EditStore {
	if (!session.editStore) {
		session.editStore = new EditStore();
	}
	const store = session.editStore;
	if (session.cwd !== undefined) {
		syncStoreEncodingPolicy(store, session.cwd);
	}
	return store;
}

const lastSyncedPolicy = new WeakMap<EditStore, { root: string; mtimeMs: number; json: string } | null>();

function syncStoreEncodingPolicy(store: EditStore, cwd: string): void {
	const discovered = discoverEncodingPolicy(cwd);
	const last = lastSyncedPolicy.get(store);
	if (discovered) {
		// Content participates in the comparison: a rewrite that keeps the
		// mtime (same timestamp granularity) changed the rules all the same.
		if (last?.root === discovered.root && last.mtimeMs === discovered.mtimeMs && last.json === discovered.json) {
			return;
		}
		store.setEncodingPolicy(discovered.root, discovered.json);
		// Snapshots recorded under a different policy could "recover" stale
		// tags with the wrong decode; policy changes drop the whole history.
		store.clear();
		lastSyncedPolicy.set(store, {
			root: discovered.root,
			mtimeMs: discovered.mtimeMs,
			json: discovered.json,
		});
	} else if (last !== null) {
		// Policy removed mid-session: restore UTF-8-only decoding.
		store.setEncodingPolicy(undefined, undefined);
		store.clear();
		lastSyncedPolicy.set(store, null);
	} else {
		lastSyncedPolicy.set(store, null);
	}
}

const SEEN_ROW_PREFIX = /^[ *]?(\d+)(?:-(\d+))?:/;

/**
 * Seen-line entry that no edit can anchor (lines are 1-based). An empty seen set
 * means unrestricted provenance (a `write` tag), so a display whose every row was
 * column-cut records this instead: provenance present, no source line fully shown.
 */
const NO_FULL_LINE = 0;

/** Record numbered output without treating column-cut rows as complete source lines. */
export function recordFullySeenRows(
	store: EditStore,
	path: string,
	tag: string,
	body: string,
	cutLines?: ReadonlySet<number>,
): void {
	if (!cutLines?.size) {
		store.recordSeenLinesFromBody(path, tag, body);
		return;
	}
	store.recordSeenLines(path, tag, [NO_FULL_LINE]);
	const completeRows = body
		.split("\n")
		.filter(row => {
			const prefix = SEEN_ROW_PREFIX.exec(row);
			return !prefix || (!cutLines.has(Number(prefix[1])) && (!prefix[2] || !cutLines.has(Number(prefix[2]))));
		})
		.join("\n");
	store.recordSeenLinesFromBody(path, tag, completeRows);
}
