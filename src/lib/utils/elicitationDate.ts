/**
 * `date` and `datetime-local` inputs only accept `YYYY-MM-DD[THH:mm]`, so an RFC 3339
 * default — which is what the schema asks servers to send — renders as blank unless it is
 * narrowed to the shape the control understands.
 */
export function forDateInput(value: string, format: "date" | "date-time"): string {
	// A date-only string parses as UTC midnight, so reading it back out in local time would
	// show the day before to everyone west of it.
	if (format === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return format === "date" ? value.slice(0, 10) : "";
	const pad = (n: number) => String(n).padStart(2, "0");
	const day = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
	if (format === "date") return day;
	return `${day}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}
