export interface MigrationResult {
	_id: string;
	name: string;
	status: "success" | "failure" | "ongoing";
}
