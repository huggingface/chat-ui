export interface MigrationResult {
	guid: ReturnType<typeof crypto.randomUUID>; // must be hardcoded randomUUID. Do not change it once pushed!
	name: string;
	status: "success" | "failure" | "ongoing";
}
