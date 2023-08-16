import crypto from "crypto-js";

export function getSignatureKey(
	key: string,
	dateStamp: string,
	regionName: string,
	serviceName: string
) {
	const kDate = crypto.HmacSHA256(dateStamp, "AWS4" + key);
	const kRegion = crypto.HmacSHA256(regionName, kDate);
	const kService = crypto.HmacSHA256(serviceName, kRegion);
	const kSigning = crypto.HmacSHA256("aws4_request", kService);
	return kSigning;
}
