export interface GAEvent {
	hitType: "event";
	eventCategory: string;
	eventAction: string;
	eventLabel?: string;
	eventValue?: number;
}

// Send a Google Analytics event
export function sendAnalyticsEvent({
	eventCategory,
	eventAction,
	eventLabel,
	eventValue,
}: Omit<GAEvent, "hitType">): void {
	// Mandatory fields
	const event: GAEvent = {
		hitType: "event",
		eventCategory,
		eventAction,
	};
	// Optional fields
	if (eventLabel) {
		event.eventLabel = eventLabel;
	}
	if (eventValue) {
		event.eventValue = eventValue;
	}

	// @ts-expect-error typescript doesn't know gtag is on the window object
	if (!!window?.gtag && typeof window?.gtag === "function") {
		// @ts-expect-error typescript doesn't know gtag is on the window object
		window?.gtag("event", eventAction, {
			event_category: event.eventCategory,
			event_label: event.eventLabel,
			value: event.eventValue,
		});
	}
}
