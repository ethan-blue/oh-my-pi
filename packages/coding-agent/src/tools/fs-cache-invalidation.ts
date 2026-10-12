import { invalidateFsScanCache } from "@oh-my-pi/pi-natives";
import { ToolError } from "@oh-my-pi/pi-tui/tools/tool-errors";
import { invalidateEncodingCaches } from "../encoding/index";
import { invalidateProtectedModeCaches } from "./protected-mode";

/** Policy changes must land before a new source-edit call captures its rules. */
export function assertConfigMutationBatch(paths: readonly string[]): void {
	const isPolicy = (path: string) =>
		/(?:^|\/)\.(?:ompg|omp)\/(?:encoding\.json|protected-mode\.json|config\.ya?ml)$/i.test(
			path.replaceAll("\\", "/"),
		);
	if (paths.some(isPolicy) && paths.some(path => !isPolicy(path))) {
		throw new ToolError(
			"Change project policy and source files in separate tool calls; refusing a mixed batch before any writes.",
		);
	}
}

/** Every tool mutation of either config namespace must invalidate discovery. */
export function invalidateConfigCachesAfterMutation(path: string): void {
	const components = path.replaceAll("\\", "/").toLowerCase().split("/");
	if (!components.includes(".ompg") && !components.includes(".omp")) return;
	invalidateEncodingCaches();
	invalidateProtectedModeCaches();
}

/**
 * Invalidate shared filesystem scan caches after a content write/update.
 */
export function invalidateFsScanAfterWrite(path: string): void {
	invalidateConfigCachesAfterMutation(path);
	invalidateFsScanCache(path);
}

/**
 * Invalidate shared filesystem scan caches after deleting a file.
 */
export function invalidateFsScanAfterDelete(path: string): void {
	invalidateConfigCachesAfterMutation(path);
	invalidateFsScanCache(path);
}

/**
 * Invalidate shared filesystem scan caches after a rename/move.
 *
 * Some watchers care about the disappearance at the old path; others about the
 * appearance at the new one. Bust both to keep callers honest.
 */
export function invalidateFsScanAfterRename(oldPath: string, newPath: string): void {
	invalidateConfigCachesAfterMutation(oldPath);
	invalidateConfigCachesAfterMutation(newPath);
	invalidateFsScanCache(oldPath);
	if (newPath !== oldPath) {
		invalidateFsScanCache(newPath);
	}
}
