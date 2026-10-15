/** toast text for a 402 by x-error-code, undefined means the subscribe modal */
export function paymentErrorNotice(errorCode: string | undefined): string | undefined {
	switch (errorCode) {
		case "PayAsYouGoNotEnabled":
			return "This model's inference provider isn't available right now. Set its provider to Auto in Settings, or pick another model.";
		case "PaymentMethodRequired":
			return "Add a payment method to your Hugging Face account (Settings → Billing) to keep using this model.";
		case "InferenceRequestLimitReached":
			return "You've reached your monthly request limit for this provider. Upgrade to PRO or Team for higher limits.";
		case "BillingAccountProvisioning":
			return "Your billing account is still being set up. Try again in a minute.";
		default:
			return undefined;
	}
}
